import { describe, expect, it } from "vitest";

import { TEST_TONE } from "@/test/fixtures";

import {
  decodeBinaryPreset,
  findGridBlock,
  type QCGridBlock,
  type QCGridBypass,
  type QCGridParameter,
  type QCGridSnapshot,
} from "./grid-messages";
import { parseModelRepo } from "./model-catalog";
import { QCSessionError, type QCSessionInfo } from "./session";
import {
  applyToneToCurrentGrid,
  preflightToneForCurrentGrid,
  QCToneTransferPreflightError,
  QCToneTransferRollbackError,
  resolveToneForQC,
  type QCToneTransferSession,
} from "./tone-transfer";
import {
  decodeTypedMessage,
  QC_MESSAGE_ACTION,
  QC_MESSAGE_TYPE,
} from "./typed-messages";

const MODEL_REPO = Buffer.from(`
<Models>
  <Category id="1" name="Drive">
    <Model id="27" name="Green 808" tm="Ibanez Tube Screamer TS808">
      <Parameter name="OVERDRIVE" type="knob" />
      <Parameter name="TONE" type="knob" />
      <Parameter name="LEVEL" type="knob" />
    </Model>
  </Category>
  <Category id="2" name="Guitar Amplifier">
    <Model id="1141" name="CA John's 2C Ch3" tm="Mesa Boogie JP-2C">
      <Parameter name="GAIN" type="knob" />
      <Parameter name="BASS" type="knob" />
      <Parameter name="MID" type="knob" />
      <Parameter name="TREBLE" type="knob" />
    </Model>
  </Category>
  <Category id="3" name="Cab">
    <Model id="12001" name="4x12 CA Stand OS S V30 90s (M)" tm="Mesa Boogie Rectifier 4x12">
    </Model>
  </Category>
  <Category id="4" name="Delay">
    <Model id="6005" name="Digital Delay (M)" tm="Digital Delay">
      <Parameter name="MIX" type="knob" />
      <Parameter name="FEEDBACK" type="knob" />
      <Parameter name="SYNC" type="switch" steps="2" />
      <Parameter name="TRAILS" type="switch" steps="2" />
    </Model>
  </Category>
  <Category id="29" name="IRLoaders">
    <Model id="29001" name="Single (M)">
      <Parameter name="IR PATH" type="string" />
      <Parameter name="IR PATH" type="string" />
      <Parameter name="IR PATH" type="string" />
    </Model>
  </Category>
</Models>`);

const MODEL_CATALOG = parseModelRepo(MODEL_REPO);

function cloneSnapshot(snapshot: QCGridSnapshot): QCGridSnapshot {
  return structuredClone(snapshot);
}

function mutableBlocks(snapshot: QCGridSnapshot): QCGridBlock[] {
  return snapshot.blocks as QCGridBlock[];
}

function mutableBypass(snapshot: QCGridSnapshot): QCGridBypass[] {
  return snapshot.bypass as QCGridBypass[];
}

function mutableParameters(block: QCGridBlock): QCGridParameter[] {
  return block.parameters as QCGridParameter[];
}

class FakeTransferSession implements QCToneTransferSession {
  readonly mutations: Buffer[] = [];
  snapshot: QCGridSnapshot;
  activeScene = 3;
  failAtMutation?: number;
  failRemoval = false;
  zenosVersion = "4.0.1";

  constructor(snapshot?: Partial<QCGridSnapshot>) {
    this.snapshot = {
      name: "Empty transfer test",
      defaultScene: 3,
      sceneLabels: ["A", "B", "C", "D", "E", "F", "G", "H"],
      blocks: [],
      bypass: [],
      ...snapshot,
    };
  }

  getInfo(): QCSessionInfo {
    return {
      sessionId: "0123456789abcdef0123456789abcdef",
      version: {
        zenosVersion: this.zenosVersion,
        appFirmwareVersion: "d14e",
      },
      modelRepoPayload: MODEL_REPO,
      modelCatalog: MODEL_CATALOG,
    };
  }

  async readCurrentPreset(): Promise<QCGridSnapshot> {
    return cloneSnapshot(this.snapshot);
  }

  async readActiveScene(): Promise<number> {
    return this.activeScene;
  }

  async switchScene(scene: number): Promise<void> {
    this.activeScene = scene;
  }

  async setSceneLabel(scene: number, label: string): Promise<void> {
    const labels = [...this.snapshot.sceneLabels];
    labels[scene] = label.trim() || " ";
    this.snapshot = { ...this.snapshot, sceneLabels: labels };
  }

  async applyGridMutation(
    payload: Uint8Array,
    matches: (snapshot: QCGridSnapshot) => boolean,
  ): Promise<void> {
    const message = decodeTypedMessage(QC_MESSAGE_TYPE.grid, payload);
    const sparse = decodeBinaryPreset(message.binaryPresetPayload!);
    this.mutations.push(Buffer.from(payload));
    if (
      this.failRemoval &&
      message.action === QC_MESSAGE_ACTION.delete
    ) {
      throw new QCSessionError("simulated removal failure");
    }
    this.applySparseMutation(sparse, message.action);
    if (this.failAtMutation === this.mutations.length) {
      throw new QCSessionError("simulated apply failure after device write");
    }
    if (!matches(sparse)) {
      throw new QCSessionError("test double produced a non-matching echo");
    }
  }

  private applySparseMutation(
    sparse: QCGridSnapshot,
    action: number | undefined,
  ): void {
    this.snapshot = cloneSnapshot(this.snapshot);
    for (const update of sparse.blocks) {
      const blocks = mutableBlocks(this.snapshot);
      const existingIndex = blocks.findIndex(
        (block) =>
          block.row === update.row && block.column === update.column,
      );
      if (action === QC_MESSAGE_ACTION.delete || update.modelId === 0) {
        if (existingIndex !== -1) blocks.splice(existingIndex, 1);
        const bypassIndex = mutableBypass(this.snapshot).findIndex(
          (value) =>
            value.row === update.row && value.column === update.column,
        );
        if (bypassIndex !== -1) {
          mutableBypass(this.snapshot).splice(bypassIndex, 1);
        }
        continue;
      }

      if (update.modelId !== undefined) {
        const placed: QCGridBlock = {
          row: update.row,
          column: update.column,
          modelId: update.modelId,
          parameters: [],
        };
        if (existingIndex === -1) blocks.push(placed);
        else blocks[existingIndex] = placed;
        mutableBypass(this.snapshot).push({
          row: update.row,
          column: update.column,
          sceneMode: false,
          values: [false],
        });
        continue;
      }

      const target = findGridBlock(this.snapshot, update.row, update.column);
      if (!target) throw new Error("parameter update targeted an empty cell");
      for (const parameterUpdate of update.parameters) {
        const parameters = mutableParameters(target);
        let parameter = parameters.find(
          (candidate) => candidate.index === parameterUpdate.index,
        );
        if (!parameter) {
          parameter = {
            index: parameterUpdate.index,
            values: [],
          };
          parameters.push(parameter);
        }
        if (parameterUpdate.sceneMode !== undefined) {
          const base = parameter.values[0] ?? { kind: "float", value: 0 };
          parameter.sceneMode = parameterUpdate.sceneMode;
          parameter.values = parameterUpdate.sceneMode
            ? Array.from({ length: 8 }, () => structuredClone(base))
            : [structuredClone(base)];
        }
        if (parameterUpdate.values[0]) {
          const values = [...parameter.values];
          values[parameter.sceneMode ? this.activeScene : 0] =
            structuredClone(parameterUpdate.values[0]);
          parameter.values = values;
        }
      }
    }

    for (const bypassUpdate of sparse.bypass) {
      const bypass = mutableBypass(this.snapshot).find(
        (candidate) =>
          candidate.row === bypassUpdate.row &&
          candidate.column === bypassUpdate.column,
      );
      if (!bypass || bypassUpdate.values[0] === undefined) continue;
      const values = [...bypass.values];
      values[bypass.sceneMode ? this.activeScene : 0] =
        bypassUpdate.values[0];
      bypass.values = values;
    }
  }
}

describe("transactional Quad Cortex tone transfer", () => {
  it("resolves live models, parameters, switches, and published options", () => {
    const resolved = resolveToneForQC(TEST_TONE, MODEL_CATALOG);

    expect(resolved.blocks.map((block) => block.model.id)).toEqual([
      27, 1141, 12001, 6005,
    ]);
    expect(resolved.blocks[0].parameters[0].value).toEqual({
      kind: "float",
      value: 0.12,
    });
    expect(resolved.blocks[3].parameters[2].value).toEqual({
      kind: "float",
      value: 1,
    });
  });

  it("resolves the indexed IR path despite duplicate live parameter names", () => {
    const tone = structuredClone(TEST_TONE);
    tone.signal_chain[2] = {
      ...tone.signal_chain[2],
      device_id: "ir-loader",
      device_name: "IR Loader",
      parameters: { IR_PATH: "CIR_TEST_FIXTURE_001" },
    };

    const resolved = resolveToneForQC(tone, MODEL_CATALOG);

    expect(resolved.blocks[2].model.id).toBe(29001);
    expect(resolved.blocks[2].parameters[0]).toMatchObject({
      specification: { index: 2, name: "IR PATH" },
      value: {
        kind: "string",
        value: "CIR_TEST_FIXTURE_001",
      },
    });
  });

  it("applies and verifies a tone while restoring the selected scene", async () => {
    const session = new FakeTransferSession();
    const phases: string[] = [];

    const result = await applyToneToCurrentGrid(TEST_TONE, session, {
      onProgress: ({ phase }) => phases.push(phase),
    });

    expect(result).toEqual({
      appliedBlocks: 4,
      appliedParameters: 11,
      configuredScenes: 2,
      firmware: "4.0.1/d14e",
    });
    expect(session.activeScene).toBe(3);
    expect(session.snapshot.blocks).toHaveLength(4);
    expect(session.snapshot.sceneLabels.slice(0, 2)).toEqual([
      "Rhythm",
      "Lead",
    ]);
    expect(phases).toContain("complete");
  });

  it("reports transfer readiness without sending a grid mutation", async () => {
    const session = new FakeTransferSession();

    await expect(
      preflightToneForCurrentGrid(TEST_TONE, session),
    ).resolves.toEqual({
      ready: true,
      firmware: "4.0.1/d14e",
      targetCells: ["1.1", "1.2", "1.3", "1.4"],
      requiredBlocks: 4,
      configuredScenes: 2,
    });
    expect(session.mutations).toHaveLength(0);
    expect(session.snapshot.blocks).toHaveLength(0);
    expect(session.activeScene).toBe(3);
  });

  it("refuses occupied target cells before sending a mutation", async () => {
    const session = new FakeTransferSession({
      blocks: [{ row: 0, column: 1, modelId: 999, parameters: [] }],
    });

    await expect(
      applyToneToCurrentGrid(TEST_TONE, session),
    ).rejects.toThrow(QCToneTransferPreflightError);
    expect(session.mutations).toHaveLength(0);
    expect(session.snapshot.blocks).toHaveLength(1);
  });

  it("blocks mutations on a firmware without hardware verification", async () => {
    const session = new FakeTransferSession();
    session.zenosVersion = "4.2.0";

    await expect(applyToneToCurrentGrid(TEST_TONE, session)).rejects.toThrow(
      "Preset mutations are not verified",
    );
    expect(session.mutations).toHaveLength(0);
  });

  it("rolls back every target cell after a write is accepted but errors", async () => {
    const session = new FakeTransferSession();
    session.failAtMutation = 1;

    await expect(applyToneToCurrentGrid(TEST_TONE, session)).rejects.toThrow(
      "Quad Cortex tone apply failed",
    );
    expect(session.snapshot.blocks).toHaveLength(0);
    expect(session.snapshot.sceneLabels).toEqual([
      "A", "B", "C", "D", "E", "F", "G", "H",
    ]);
    expect(session.activeScene).toBe(3);
  });

  it("surfaces an unverified rollback as a distinct critical failure", async () => {
    const session = new FakeTransferSession();
    session.failAtMutation = 1;
    session.failRemoval = true;

    await expect(applyToneToCurrentGrid(TEST_TONE, session)).rejects.toThrow(
      QCToneTransferRollbackError,
    );
    expect(session.snapshot.blocks).toHaveLength(1);
  });

  it("rejects a value whose type is unsafe for its profiled control", () => {
    const tone = structuredClone(TEST_TONE);
    tone.signal_chain[3].parameters.SYNC = "invented switch value";

    expect(() => resolveToneForQC(tone, MODEL_CATALOG)).toThrow(
      QCToneTransferPreflightError,
    );
  });
});
