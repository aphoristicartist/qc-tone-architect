import { describe, expect, it, vi } from "vitest";

import {
  decodeBinaryPreset,
  encodePlaceBlock,
  findGridBlock,
} from "./grid-messages";
import {
  encodeHIDReports,
  QC_HID_INPUT_REPORT_ID,
} from "./hid-framing";
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
} from "./message-envelope";
import {
  encodeBytesField,
  encodeStringField,
  encodeVarintField,
} from "./protobuf-wire";
import {
  QCFirmwareCompatibilityError,
  QCSession,
  QCSessionTimeoutError,
  type QCSessionConnection,
} from "./session";
import {
  decodeTypedMessage,
  encodeModelRepoResponse,
  encodeResetCommsBuffers,
  QC_MESSAGE_ACTION,
  QC_MESSAGE_TYPE,
  type QCDecodedMessage,
} from "./typed-messages";

const SESSION_ID = "0123456789abcdef0123456789abcdef";
const MODEL_REPO = Buffer.from(
  '<Models><Category id="1" name="Guitar Amplifier"><Model id="1001" name="Brit 2203" tm="Marshall JCM800"><Parameter name="GAIN" min="0" max="10" /></Model></Category></Models>',
);
const PRESET_PAYLOAD = decodeTypedMessage(
  QC_MESSAGE_TYPE.grid,
  encodePlaceBlock(0, 0, 1001),
).binaryPresetPayload!;

interface FakeOptions {
  appFirmwareVersion?: string;
  zenosVersion?: string;
  ignoredResetAttempts?: number;
  presetSceneLabels?: readonly string[];
  suppressSceneLabelEcho?: boolean;
  suppressSceneUpdateEcho?: boolean;
  silent?: boolean;
}

class FakeQCConnection implements QCSessionConnection {
  readonly sent: QCDecodedMessage[] = [];
  private readonly reportHandlers = new Set<(report: Buffer) => void>();
  private readonly disconnectHandlers = new Set<(error?: Error) => void>();
  private connected = true;
  private resetAttempts = 0;

  constructor(private readonly options: FakeOptions = {}) {}

  isConnected(): boolean {
    return this.connected;
  }

  onReport(handler: (report: Buffer) => void): () => void {
    this.reportHandlers.add(handler);
    return () => this.reportHandlers.delete(handler);
  }

  onDisconnect(handler: (error?: Error) => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  sendRawProtocolMessage(message: Uint8Array): number {
    const envelope = decodeProtocolMessage(message);
    const decoded = decodeTypedMessage(envelope.messageType, envelope.payload);
    this.sent.push(decoded);
    if (!this.options.silent) this.respond(decoded);
    return encodeHIDReports(message).length;
  }

  loseConnection(): void {
    this.connected = false;
    for (const handler of this.disconnectHandlers) {
      handler(new Error("simulated disconnect"));
    }
  }

  private respond(message: QCDecodedMessage): void {
    if (message.messageType === QC_MESSAGE_TYPE.resetCommsBuffers) {
      this.resetAttempts += 1;
      if (this.resetAttempts <= (this.options.ignoredResetAttempts ?? 0)) return;
      this.emit(
        QC_MESSAGE_TYPE.resetCommsBuffers,
        encodeResetCommsBuffers(message.sessionId!),
      );
      return;
    }

    if (message.messageType === QC_MESSAGE_TYPE.version) {
      if (message.action === QC_MESSAGE_ACTION.read) {
        this.emit(
          QC_MESSAGE_TYPE.version,
          Buffer.concat([
            encodeVarintField(1, QC_MESSAGE_ACTION.update),
            encodeStringField(4, this.options.zenosVersion ?? "4.0.1"),
            encodeStringField(
              7,
              this.options.appFirmwareVersion ?? "d14e",
            ),
            encodeStringField(9, "QC-SIMULATOR"),
            encodeBytesField(10, Buffer.from([1, 2, 3])),
            encodeVarintField(12, 0),
          ]),
        );
      } else if (message.version?.cortexControlVersion) {
        this.emit(
          QC_MESSAGE_TYPE.version,
          Buffer.concat([
            encodeVarintField(1, QC_MESSAGE_ACTION.update),
            encodeVarintField(14, true),
          ]),
        );
      }
      return;
    }

    if (
      message.messageType === QC_MESSAGE_TYPE.recallPreset &&
      message.action === QC_MESSAGE_ACTION.read &&
      message.requestId !== undefined
    ) {
      this.emit(
        QC_MESSAGE_TYPE.recallPreset,
        Buffer.concat([
          encodeVarintField(1, QC_MESSAGE_ACTION.read),
          encodeVarintField(2, message.requestId!),
          encodeBytesField(
            3,
            Buffer.concat([
              PRESET_PAYLOAD,
              ...(this.options.presetSceneLabels ?? []).map((label) =>
                encodeBytesField(15, Buffer.from(label)),
              ),
            ]),
          ),
        ]),
      );
      return;
    }

    if (
      message.messageType === QC_MESSAGE_TYPE.scene &&
      (message.action !== QC_MESSAGE_ACTION.read ||
        message.requestId !== undefined)
    ) {
      if (
        this.options.suppressSceneUpdateEcho &&
        message.action !== QC_MESSAGE_ACTION.read
      ) {
        return;
      }
      this.emit(
        QC_MESSAGE_TYPE.scene,
        Buffer.concat([
          encodeVarintField(1, QC_MESSAGE_ACTION.update),
          ...(message.requestId === undefined
            ? []
            : [encodeVarintField(2, message.requestId)]),
          encodeVarintField(
            3,
            message.action === QC_MESSAGE_ACTION.read
              ? 2
              : message.selectedScene!,
          ),
        ]),
      );
      return;
    }

    if (message.messageType === QC_MESSAGE_TYPE.sceneLabel) {
      if (this.options.suppressSceneLabelEcho) return;
      this.emit(QC_MESSAGE_TYPE.sceneLabel, message.payload);
      return;
    }

    if (message.messageType === QC_MESSAGE_TYPE.grid) {
      this.emit(QC_MESSAGE_TYPE.grid, message.payload);
    }

    if (
      message.messageType === QC_MESSAGE_TYPE.modelRepo &&
      message.action === QC_MESSAGE_ACTION.read
    ) {
      this.emit(
        QC_MESSAGE_TYPE.modelRepo,
        encodeModelRepoResponse(MODEL_REPO),
      );
    }
  }

  private emit(messageType: number, payload: Uint8Array): void {
    const reports = encodeHIDReports(encodeProtocolMessage(messageType, payload));
    queueMicrotask(() => {
      for (const outputReport of reports) {
        const inputReport = Buffer.from(outputReport);
        inputReport[0] = QC_HID_INPUT_REPORT_ID;
        for (const handler of this.reportHandlers) handler(inputReport);
      }
    });
  }
}

function sessionOptions() {
  return {
    requestTimeoutMs: 20,
    modelRepoTimeoutMs: 20,
    handshakePatienceMs: 0,
    settleMs: 0,
    keepAliveIntervalMs: 60_000,
    sessionIdFactory: () => SESSION_ID,
  };
}

describe("typed Quad Cortex session", () => {
  it("performs the complete gated handshake and clean disconnect", async () => {
    const connection = new FakeQCConnection();
    const session = new QCSession(connection, sessionOptions());
    const listener = vi.fn();
    session.onMessage(listener);

    const info = await session.start();

    expect(session.getState()).toBe("active");
    expect(info).toMatchObject({
      sessionId: SESSION_ID,
      version: {
        zenosVersion: "4.0.1",
        appFirmwareVersion: "d14e",
        serialNumber: "QC-SIMULATOR",
      },
      modelRepoPayload: MODEL_REPO,
    });
    expect(info.modelCatalog.get(1001)?.name).toBe("Brit 2203");
    info.version.commsVersion![0] = 255;
    expect(session.getInfo()?.version.commsVersion).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(listener).toHaveBeenCalled();
    expect(connection.sent.map((message) => message.messageType)).toEqual(
      expect.arrayContaining([
        QC_MESSAGE_TYPE.resetCommsBuffers,
        QC_MESSAGE_TYPE.version,
        QC_MESSAGE_TYPE.modelRepo,
        QC_MESSAGE_TYPE.connection,
        QC_MESSAGE_TYPE.recallPreset,
      ]),
    );
    expect(
      connection.sent.some(
        (message) =>
          message.messageType === QC_MESSAGE_TYPE.connection &&
          message.connected === true,
      ),
    ).toBe(true);

    session.close();
    expect(session.getState()).toBe("closed");
    expect(connection.sent.at(-1)).toMatchObject({
      messageType: QC_MESSAGE_TYPE.connection,
      connected: false,
    });
  });

  it("correlates typed preset, scene, label, and sparse grid operations", async () => {
    const connection = new FakeQCConnection();
    const session = new QCSession(connection, sessionOptions());
    await session.start();

    const preset = await session.readCurrentPreset();
    expect(findGridBlock(preset, 0, 0)?.modelId).toBe(1001);
    await expect(session.readActiveScene()).resolves.toBe(2);
    await expect(session.switchScene(5)).resolves.toBeUndefined();
    await expect(session.setSceneLabel(5, "Solo")).resolves.toBeUndefined();
    await expect(
      session.applyGridMutation(
        encodePlaceBlock(1, 2, 1001),
        (snapshot) => findGridBlock(snapshot, 1, 2)?.modelId === 1001,
      ),
    ).resolves.toBeUndefined();

    expect(() => decodeBinaryPreset(PRESET_PAYLOAD)).not.toThrow();
    session.close();
  });

  it("announces the matching Cortex Control protocol for CorOS 4.1.0", async () => {
    const connection = new FakeQCConnection({ zenosVersion: "4.1.0" });
    const session = new QCSession(connection, sessionOptions());

    await expect(session.start()).resolves.toMatchObject({
      version: { zenosVersion: "4.1.0", appFirmwareVersion: "d14e" },
    });
    expect(
      connection.sent.some(
        (message) =>
          message.messageType === QC_MESSAGE_TYPE.version &&
          message.version?.cortexControlVersion === "4.1.0",
      ),
    ).toBe(true);
    session.close();
  });

  it("verifies a scene label by preset read-back when CorOS omits the echo", async () => {
    const connection = new FakeQCConnection({
      presetSceneLabels: ["Comping"],
      suppressSceneLabelEcho: true,
    });
    const session = new QCSession(connection, sessionOptions());
    await session.start();

    await expect(session.setSceneLabel(0, "Comping")).resolves.toBeUndefined();
    expect(
      connection.sent.filter(
        (message) => message.messageType === QC_MESSAGE_TYPE.recallPreset,
      ),
    ).toHaveLength(2);
    session.close();
  });

  it("verifies a scene switch by correlated read when CorOS omits the echo", async () => {
    const connection = new FakeQCConnection({ suppressSceneUpdateEcho: true });
    const session = new QCSession(connection, sessionOptions());
    await session.start();

    // The fake's correlated read reports scene 2, matching the requested scene.
    await expect(session.switchScene(2)).resolves.toBeUndefined();
    expect(
      connection.sent.filter(
        (message) => message.messageType === QC_MESSAGE_TYPE.scene,
      ),
    ).toHaveLength(3);
    session.close();
  });

  it("rejects a scene switch when read-back reports another scene", async () => {
    const connection = new FakeQCConnection({ suppressSceneUpdateEcho: true });
    const session = new QCSession(connection, sessionOptions());
    await session.start();

    await expect(session.switchScene(5)).rejects.toBeInstanceOf(
      QCSessionTimeoutError,
    );
    session.close();
  });

  it("rejects a scene label when neither echo nor read-back confirms it", async () => {
    const connection = new FakeQCConnection({
      presetSceneLabels: ["Clean"],
      suppressSceneLabelEcho: true,
    });
    const session = new QCSession(connection, sessionOptions());
    await session.start();

    await expect(session.setSceneLabel(0, "Solo")).rejects.toBeInstanceOf(
      QCSessionTimeoutError,
    );
    session.close();
  });

  it("retries an openable but initially silent device", async () => {
    const connection = new FakeQCConnection({ ignoredResetAttempts: 1 });
    const session = new QCSession(connection, {
      ...sessionOptions(),
      requestTimeoutMs: 5,
      modelRepoTimeoutMs: 10,
      handshakePatienceMs: 100,
    });

    await expect(session.start()).resolves.toMatchObject({
      sessionId: SESSION_ID,
    });
    expect(
      connection.sent.filter(
        (message) =>
          message.messageType === QC_MESSAGE_TYPE.resetCommsBuffers,
      ),
    ).toHaveLength(2);
    session.close();
  });

  it("fails closed on an unverified firmware", async () => {
    const connection = new FakeQCConnection({ appFirmwareVersion: "future" });
    const session = new QCSession(connection, sessionOptions());

    await expect(session.start()).rejects.toBeInstanceOf(
      QCFirmwareCompatibilityError,
    );
    expect(session.getState()).toBe("failed");
    expect(
      connection.sent.some(
        (message) => message.messageType === QC_MESSAGE_TYPE.connection,
      ),
    ).toBe(false);
  });

  it("times out cleanly and releases its report subscription", async () => {
    const connection = new FakeQCConnection({ silent: true });
    const session = new QCSession(connection, sessionOptions());

    await expect(session.start()).rejects.toBeInstanceOf(QCSessionTimeoutError);
    expect(session.getState()).toBe("failed");
  });

  it("fails outstanding session state when the HID connection is lost", async () => {
    const connection = new FakeQCConnection();
    const session = new QCSession(connection, sessionOptions());
    await session.start();

    connection.loseConnection();

    expect(session.getState()).toBe("failed");
  });
});
