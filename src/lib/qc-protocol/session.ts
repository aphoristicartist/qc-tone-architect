import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { HIDReportAssembler } from "./hid-framing";
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
} from "./message-envelope";
import {
  decodeBinaryPreset,
  type QCGridSnapshot,
} from "./grid-messages";
import { parseModelRepo, type QCModelCatalog } from "./model-catalog";
import { encodeStringField, encodeVarintField } from "./protobuf-wire";
import {
  decodeTypedMessage,
  encodeActionMessage,
  encodeConnection,
  encodeResetCommsBuffers,
  encodeVersionAnnouncement,
  QC_MESSAGE_ACTION,
  QC_MESSAGE_TYPE,
  type QCDecodedMessage,
  type QCVersionInfo,
} from "./typed-messages";

const MAX_DECOMPRESSED_PAYLOAD_SIZE = 4 * 1024 * 1024;

export const QC_SUPPORTED_FIRMWARE = [
  {
    zenosVersion: "4.0.1",
    appFirmwareVersion: "d14e",
    cortexControlVersion: "4.0.1",
  },
  {
    zenosVersion: "4.1.0",
    appFirmwareVersion: "d14e",
    cortexControlVersion: "4.1.0",
  },
] as const;

const SUBSCRIPTION_TYPES = [
  QC_MESSAGE_TYPE.moduleStats,
  QC_MESSAGE_TYPE.license,
  QC_MESSAGE_TYPE.undoRedo,
  QC_MESSAGE_TYPE.ioSettings,
  QC_MESSAGE_TYPE.generalSettings,
  QC_MESSAGE_TYPE.showGigView,
  QC_MESSAGE_TYPE.mode,
  QC_MESSAGE_TYPE.globalEQ,
  QC_MESSAGE_TYPE.masterVolume,
  QC_MESSAGE_TYPE.file,
  QC_MESSAGE_TYPE.recentsFavorites,
  QC_MESSAGE_TYPE.compilerInhibitedModules,
  QC_MESSAGE_TYPE.recallPreset,
  QC_MESSAGE_TYPE.newModels,
  QC_MESSAGE_TYPE.pinnedModels,
  QC_MESSAGE_TYPE.defaultParameters,
  QC_MESSAGE_TYPE.globalTempo,
  QC_MESSAGE_TYPE.setlistPosition,
  QC_MESSAGE_TYPE.presetDirty,
  QC_MESSAGE_TYPE.scene,
  QC_MESSAGE_TYPE.bulkOperation,
  QC_MESSAGE_TYPE.updater,
] as const;

export class QCSessionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QCSessionError";
  }
}

export class QCSessionTimeoutError extends QCSessionError {
  constructor(message: string) {
    super(message);
    this.name = "QCSessionTimeoutError";
  }
}

export class QCFirmwareCompatibilityError extends QCSessionError {
  constructor(message: string) {
    super(message);
    this.name = "QCFirmwareCompatibilityError";
  }
}

export interface QCSessionConnection {
  isConnected(): boolean;
  onReport(handler: (report: Buffer) => void): () => void;
  onDisconnect?(handler: (error?: Error) => void): () => void;
  sendRawProtocolMessage(message: Uint8Array): number;
}

export interface QCSupportedFirmware {
  zenosVersion: string;
  appFirmwareVersion: string;
  cortexControlVersion?: string;
}

export interface QCSessionOptions {
  cortexControlVersion?: string;
  requestTimeoutMs?: number;
  modelRepoTimeoutMs?: number;
  presetReadTimeoutMs?: number;
  handshakePatienceMs?: number;
  settleMs?: number;
  keepAliveIntervalMs?: number;
  allowUnsupportedFirmware?: boolean;
  supportedFirmware?: readonly QCSupportedFirmware[];
  sessionIdFactory?: () => string;
}

export interface QCSessionInfo {
  sessionId: string;
  version: QCVersionInfo;
  modelRepoPayload: Buffer;
  modelCatalog: QCModelCatalog;
}

export type QCSessionState =
  | "idle"
  | "starting"
  | "active"
  | "failed"
  | "closed";

type MessagePredicate = (message: QCDecodedMessage) => boolean;
type MessageListener = (message: QCDecodedMessage) => void;

interface MessageWaiter {
  messageType: number;
  predicate: MessagePredicate;
  resolve: (message: QCDecodedMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_OPTIONS = {
  requestTimeoutMs: 5_000,
  modelRepoTimeoutMs: 25_000,
  presetReadTimeoutMs: 15_000,
  handshakePatienceMs: 30_000,
  settleMs: 2_000,
  keepAliveIntervalMs: 5_000,
} as const;

function positiveDuration(name: string, value: number, allowZero = false): void {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < (allowZero ? 0 : 1)
  ) {
    throw new QCSessionError(
      `${name} must be ${allowZero ? "non-negative" : "positive"} milliseconds`,
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function maybeDecompress(payload: Buffer): Buffer {
  if (payload[0] !== 0x1f || payload[1] !== 0x8b) return payload;
  return gunzipSync(payload, {
    maxOutputLength: MAX_DECOMPRESSED_PAYLOAD_SIZE,
  });
}

export class QCSession {
  private readonly assembler = new HIDReportAssembler();
  private readonly listeners = new Set<MessageListener>();
  private readonly waiters = new Set<MessageWaiter>();
  private readonly options: Required<
    Omit<
      QCSessionOptions,
      | "allowUnsupportedFirmware"
      | "cortexControlVersion"
      | "supportedFirmware"
      | "sessionIdFactory"
    >
  > &
    Pick<
      QCSessionOptions,
      | "allowUnsupportedFirmware"
      | "cortexControlVersion"
      | "supportedFirmware"
      | "sessionIdFactory"
    >;
  private unsubscribeReport?: () => void;
  private unsubscribeDisconnect?: () => void;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  private state: QCSessionState = "idle";
  private requestId = BigInt(1);
  private connectedAnnounced = false;
  private sessionInfo?: QCSessionInfo;

  constructor(
    private readonly connection: QCSessionConnection,
    options: QCSessionOptions = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    positiveDuration("requestTimeoutMs", this.options.requestTimeoutMs);
    positiveDuration("modelRepoTimeoutMs", this.options.modelRepoTimeoutMs);
    positiveDuration("presetReadTimeoutMs", this.options.presetReadTimeoutMs);
    positiveDuration(
      "handshakePatienceMs",
      this.options.handshakePatienceMs,
      true,
    );
    positiveDuration("settleMs", this.options.settleMs, true);
    positiveDuration(
      "keepAliveIntervalMs",
      this.options.keepAliveIntervalMs,
    );
  }

  getState(): QCSessionState {
    return this.state;
  }

  getInfo(): QCSessionInfo | undefined {
    if (!this.sessionInfo) return undefined;
    return {
      ...this.sessionInfo,
      version: {
        ...this.sessionInfo.version,
        commsVersion: this.sessionInfo.version.commsVersion
          ? Buffer.from(this.sessionInfo.version.commsVersion)
          : undefined,
      },
      modelRepoPayload: Buffer.from(this.sessionInfo.modelRepoPayload),
    };
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async readCurrentPreset(
    timeoutMs = this.options.presetReadTimeoutMs,
  ): Promise<QCGridSnapshot> {
    this.assertActive();
    positiveDuration("preset read timeout", timeoutMs);
    const requestId = this.nextRequestId();
    const message = await this.awaitMessage(
      QC_MESSAGE_TYPE.recallPreset,
      (candidate) =>
        candidate.requestId === requestId &&
        candidate.binaryPresetPayload !== undefined,
      () =>
        this.send(
          QC_MESSAGE_TYPE.recallPreset,
          encodeActionMessage(QC_MESSAGE_ACTION.read, requestId),
        ),
      timeoutMs,
    );
    return decodeBinaryPreset(message.binaryPresetPayload!);
  }

  async readActiveScene(
    timeoutMs = this.options.requestTimeoutMs,
  ): Promise<number> {
    this.assertActive();
    positiveDuration("scene read timeout", timeoutMs);
    const requestId = this.nextRequestId();
    const message = await this.awaitMessage(
      QC_MESSAGE_TYPE.scene,
      (candidate) =>
        candidate.requestId === requestId &&
        candidate.selectedScene !== undefined,
      () =>
        this.send(
          QC_MESSAGE_TYPE.scene,
          encodeActionMessage(QC_MESSAGE_ACTION.read, requestId),
        ),
      timeoutMs,
    );
    return message.selectedScene!;
  }

  async switchScene(
    scene: number,
    timeoutMs = this.options.requestTimeoutMs,
  ): Promise<void> {
    this.assertActive();
    positiveDuration("scene mutation timeout", timeoutMs);
    if (!Number.isInteger(scene) || scene < 0 || scene > 7) {
      throw new QCSessionError("Scene must be between 0 and 7");
    }
    try {
      await this.awaitMessage(
        QC_MESSAGE_TYPE.scene,
        (candidate) => candidate.selectedScene === scene,
        () =>
          this.send(
            QC_MESSAGE_TYPE.scene,
            Buffer.concat([
              encodeActionMessage(QC_MESSAGE_ACTION.update),
              encodeVarintField(3, scene),
            ]),
          ),
        timeoutMs,
      );
    } catch (error) {
      if (!(error instanceof QCSessionTimeoutError)) throw error;

      // CorOS 4.1 can switch scenes without echoing the update. Confirm the
      // selected scene with a request-id-correlated read before accepting it.
      if ((await this.readActiveScene(timeoutMs)) !== scene) throw error;
    }
  }

  async setSceneLabel(
    scene: number,
    label: string,
    timeoutMs = this.options.requestTimeoutMs,
  ): Promise<void> {
    this.assertActive();
    positiveDuration("scene label mutation timeout", timeoutMs);
    if (!Number.isInteger(scene) || scene < 0 || scene > 7) {
      throw new QCSessionError("Scene must be between 0 and 7");
    }
    const normalizedLabel = label.trim() ? label : " ";
    if (normalizedLabel.length > 40) {
      throw new QCSessionError("Scene label cannot exceed 40 characters");
    }
    try {
      await this.awaitMessage(
        QC_MESSAGE_TYPE.sceneLabel,
        (candidate) =>
          candidate.sceneIndex === scene &&
          candidate.sceneLabel === normalizedLabel,
        () =>
          this.send(
            QC_MESSAGE_TYPE.sceneLabel,
            Buffer.concat([
              encodeActionMessage(QC_MESSAGE_ACTION.update),
              encodeVarintField(3, scene),
              encodeStringField(4, normalizedLabel),
            ]),
          ),
        timeoutMs,
      );
    } catch (error) {
      if (!(error instanceof QCSessionTimeoutError)) throw error;

      // CorOS 4.1 persists scene labels without echoing message type 23.
      // Treat a correlated preset read-back as the acknowledgement instead.
      const snapshot = await this.readCurrentPreset(timeoutMs);
      const actualLabel = snapshot.sceneLabels[scene] ?? "";
      const matches = normalizedLabel.trim()
        ? actualLabel === normalizedLabel
        : !actualLabel.trim();
      if (!matches) throw error;
    }
  }

  async applyGridMutation(
    payload: Uint8Array,
    matches: (snapshot: QCGridSnapshot) => boolean,
    timeoutMs = this.options.requestTimeoutMs,
  ): Promise<void> {
    this.assertActive();
    positiveDuration("grid mutation timeout", timeoutMs);
    await this.awaitMessage(
      QC_MESSAGE_TYPE.grid,
      (candidate) =>
        candidate.binaryPresetPayload !== undefined &&
        matches(decodeBinaryPreset(candidate.binaryPresetPayload)),
      () => this.send(QC_MESSAGE_TYPE.grid, payload),
      timeoutMs,
    );
  }

  async start(): Promise<QCSessionInfo> {
    if (this.state !== "idle") {
      throw new QCSessionError(`Cannot start a QC session from ${this.state}`);
    }
    if (!this.connection.isConnected()) {
      throw new QCSessionError("The Quad Cortex HID connection is not open");
    }

    this.state = "starting";
    this.unsubscribeReport = this.connection.onReport((report) => {
      this.handleReport(report);
    });
    this.unsubscribeDisconnect = this.connection.onDisconnect?.((error) => {
      this.fail(
        new QCSessionError("The Quad Cortex connection was lost", {
          cause: error,
        }),
      );
    });

    const deadline = Date.now() + this.options.handshakePatienceMs;
    let attempts = 0;
    try {
      while (true) {
        attempts += 1;
        try {
          this.sessionInfo = await this.handshake();
          break;
        } catch (error) {
          if (
            !(error instanceof QCSessionTimeoutError) ||
            Date.now() >= deadline
          ) {
            throw error;
          }
          this.bestEffortGoodbye();
        }
      }

      this.state = "active";
      this.keepAliveTimer = setInterval(() => {
        try {
          this.send(
            QC_MESSAGE_TYPE.keepAlive,
            encodeActionMessage(QC_MESSAGE_ACTION.update),
          );
        } catch (error) {
          this.fail(
            new QCSessionError("Unable to send the Quad Cortex keepalive", {
              cause: error,
            }),
          );
        }
      }, this.options.keepAliveIntervalMs);
      return this.getInfo()!;
    } catch (error) {
      const failure =
        error instanceof QCSessionError
          ? error
          : new QCSessionError("Quad Cortex session setup failed", {
              cause: error,
            });
      const reportedFailure =
        failure instanceof QCSessionTimeoutError
          ? new QCSessionTimeoutError(
              `The Quad Cortex did not complete its handshake after ${attempts} attempt(s)`,
            )
          : failure;
      this.fail(reportedFailure);
      throw reportedFailure;
    }
  }

  close(): void {
    if (this.state === "closed") return;
    this.bestEffortGoodbye();
    this.cleanup();
    this.state = "closed";
  }

  private async handshake(): Promise<QCSessionInfo> {
    const sessionId = (
      this.options.sessionIdFactory?.() ?? randomUUID().replaceAll("-", "")
    ).toLowerCase();
    const reset = await this.awaitMessage(
      QC_MESSAGE_TYPE.resetCommsBuffers,
      (message) => message.sessionId === sessionId,
      () =>
        this.send(
          QC_MESSAGE_TYPE.resetCommsBuffers,
          encodeResetCommsBuffers(sessionId),
        ),
      this.options.requestTimeoutMs,
    );
    if (reset.sessionId !== sessionId) {
      throw new QCSessionError("The Quad Cortex echoed a different session ID");
    }

    const versionMessage = await this.awaitMessage(
      QC_MESSAGE_TYPE.version,
      (message) => Boolean(message.version?.appFirmwareVersion),
      () =>
        this.send(
          QC_MESSAGE_TYPE.version,
          encodeActionMessage(QC_MESSAGE_ACTION.read, this.nextRequestId()),
        ),
      this.options.requestTimeoutMs,
    );
    const version = versionMessage.version!;
    const compatibility = this.assertCompatible(version);
    const cortexControlVersion =
      this.options.cortexControlVersion ??
      compatibility?.cortexControlVersion ??
      version.zenosVersion ??
      "4.0.1";

    const versionGate = await this.awaitMessage(
      QC_MESSAGE_TYPE.version,
      (message) =>
        message.version?.cortexControlVersionValid !== undefined,
      () =>
        this.send(
          QC_MESSAGE_TYPE.version,
          encodeVersionAnnouncement(cortexControlVersion),
        ),
      this.options.requestTimeoutMs,
    );
    if (!versionGate.version?.cortexControlVersionValid) {
      throw new QCFirmwareCompatibilityError(
        `The Quad Cortex rejected Cortex Control protocol version ${cortexControlVersion}`,
      );
    }

    const modelRepoMessage = await this.awaitMessage(
      QC_MESSAGE_TYPE.modelRepo,
      (message) => Boolean(message.modelRepoPayload?.byteLength),
      () => {
        this.send(
          QC_MESSAGE_TYPE.modelRepo,
          encodeActionMessage(QC_MESSAGE_ACTION.read),
        );
        this.send(QC_MESSAGE_TYPE.connection, encodeConnection(true));
        this.connectedAnnounced = true;
        for (const messageType of SUBSCRIPTION_TYPES) {
          this.send(
            messageType,
            encodeActionMessage(QC_MESSAGE_ACTION.read),
          );
        }
      },
      this.options.modelRepoTimeoutMs,
    );
    if (this.options.settleMs > 0) await delay(this.options.settleMs);

    const modelRepoPayload = Buffer.from(modelRepoMessage.modelRepoPayload!);
    return {
      sessionId,
      version,
      modelRepoPayload,
      modelCatalog: parseModelRepo(modelRepoPayload),
    };
  }

  private assertCompatible(
    version: QCVersionInfo,
  ): QCSupportedFirmware | undefined {
    if (version.deviceType !== 0) {
      throw new QCFirmwareCompatibilityError(
        "The connected device is not a supported Quad Cortex",
      );
    }
    if (this.options.allowUnsupportedFirmware) return undefined;

    const supported =
      this.options.supportedFirmware ?? QC_SUPPORTED_FIRMWARE;
    const match = supported.find(
        (candidate) =>
          candidate.zenosVersion === version.zenosVersion &&
          candidate.appFirmwareVersion === version.appFirmwareVersion,
      );
    if (!match) {
      throw new QCFirmwareCompatibilityError(
        `Unsupported Quad Cortex firmware (zenos ${version.zenosVersion ?? "unknown"}, app ${version.appFirmwareVersion ?? "unknown"})`,
      );
    }
    return match;
  }

  private nextRequestId(): bigint {
    const current = this.requestId;
    this.requestId += BigInt(1);
    return current;
  }

  private assertActive(): void {
    if (this.state !== "active") {
      throw new QCSessionError(`The Quad Cortex session is ${this.state}`);
    }
  }

  private send(messageType: number, payload: Uint8Array): void {
    if (!this.connection.isConnected()) {
      throw new QCSessionError("The Quad Cortex HID connection is not open");
    }
    this.connection.sendRawProtocolMessage(
      encodeProtocolMessage(messageType, payload),
    );
  }

  private awaitMessage(
    messageType: number,
    predicate: MessagePredicate,
    trigger: () => void,
    timeoutMs: number,
  ): Promise<QCDecodedMessage> {
    return new Promise((resolve, reject) => {
      const waiter: MessageWaiter = {
        messageType,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(
            new QCSessionTimeoutError(
              `No matching Quad Cortex message type ${messageType} arrived within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.add(waiter);
      try {
        trigger();
      } catch (error) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        reject(
          error instanceof Error
            ? error
            : new QCSessionError("Unable to send Quad Cortex message"),
        );
      }
    });
  }

  private handleReport(report: Buffer): void {
    try {
      const assembled = this.assembler.push(report);
      if (!assembled) return;
      const envelope = decodeProtocolMessage(assembled);
      const decoded = decodeTypedMessage(
        envelope.messageType,
        maybeDecompress(envelope.payload),
      );

      for (const listener of this.listeners) {
        try {
          listener(decoded);
        } catch {
          // A consumer cannot interrupt protocol correlation.
        }
      }

      for (const waiter of this.waiters) {
        if (
          waiter.messageType === decoded.messageType &&
          waiter.predicate(decoded)
        ) {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          waiter.resolve(decoded);
          break;
        }
      }
    } catch {
      // Malformed, unknown, or unsupported device chatter must not kill the
      // report stream. A waiter for meaningful traffic will time out cleanly.
    }
  }

  private fail(error: QCSessionError): void {
    if (this.state === "closed" || this.state === "failed") return;
    this.bestEffortGoodbye();
    this.state = "failed";
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
    this.cleanup();
  }

  private cleanup(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
    this.unsubscribeReport?.();
    this.unsubscribeReport = undefined;
    this.unsubscribeDisconnect?.();
    this.unsubscribeDisconnect = undefined;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new QCSessionError("The Quad Cortex session was closed"));
    }
    this.waiters.clear();
    this.assembler.reset();
  }

  private bestEffortGoodbye(): void {
    if (!this.connectedAnnounced) return;
    this.connectedAnnounced = false;
    if (!this.connection.isConnected()) return;
    try {
      this.send(QC_MESSAGE_TYPE.connection, encodeConnection(false));
    } catch {
      // A dead link must not prevent retry or local teardown.
    }
  }
}
