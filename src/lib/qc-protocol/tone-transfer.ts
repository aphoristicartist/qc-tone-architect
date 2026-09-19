import { getDeviceById, type DeviceParameter } from "../devices";
import { tonePresetSchema } from "../tone-schema";
import type { TonePreset } from "../types";
import {
  encodePlaceBlock,
  encodeRemoveBlock,
  encodeSetBlockBypass,
  encodeSetBlockParameter,
  encodeSetParameterSceneMode,
  findGridBlock,
  type QCGridBlock,
  type QCGridParameterValue,
  type QCGridSnapshot,
} from "./grid-messages";
import {
  QCModelCatalogError,
  type QCModel,
  type QCModelCatalog,
  type QCModelParameter,
} from "./model-catalog";
import {
  QCFirmwareCompatibilityError,
  QCSessionError,
  QCSessionTimeoutError,
  type QCSessionInfo,
} from "./session";

export const QC_TRANSFER_VERIFIED_FIRMWARE = [
  { zenosVersion: "4.0.1", appFirmwareVersion: "d14e" },
  { zenosVersion: "4.1.0", appFirmwareVersion: "d14e" },
] as const;

export class QCToneTransferError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QCToneTransferError";
  }
}

export class QCToneTransferPreflightError extends QCToneTransferError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QCToneTransferPreflightError";
  }
}

export class QCToneTransferRollbackError extends QCToneTransferError {
  readonly applyError: Error;
  readonly rollbackError: Error;

  constructor(applyError: Error, rollbackError: Error) {
    super(
      `Tone apply failed and rollback could not be verified: ${rollbackError.message}`,
      { cause: applyError },
    );
    this.name = "QCToneTransferRollbackError";
    this.applyError = applyError;
    this.rollbackError = rollbackError;
  }
}

export interface QCToneTransferSession {
  getInfo(): QCSessionInfo | undefined;
  readCurrentPreset(timeoutMs?: number): Promise<QCGridSnapshot>;
  readActiveScene(timeoutMs?: number): Promise<number>;
  switchScene(scene: number, timeoutMs?: number): Promise<void>;
  setSceneLabel(
    scene: number,
    label: string,
    timeoutMs?: number,
  ): Promise<void>;
  applyGridMutation(
    payload: Uint8Array,
    matches: (snapshot: QCGridSnapshot) => boolean,
    timeoutMs?: number,
  ): Promise<void>;
}

export interface QCResolvedParameter {
  name: string;
  specification: QCModelParameter;
  value: QCGridParameterValue;
}

export interface QCResolvedBlock {
  row: number;
  column: number;
  model: QCModel;
  bypassed: boolean;
  parameters: readonly QCResolvedParameter[];
}

export interface QCResolvedSceneChange {
  row: number;
  column: number;
  parameters: readonly QCResolvedParameter[];
}

export interface QCResolvedScene {
  index: number;
  name: string;
  changes: readonly QCResolvedSceneChange[];
}

export interface QCResolvedTone {
  tone: TonePreset;
  blocks: readonly QCResolvedBlock[];
  scenes: readonly QCResolvedScene[];
}

export type QCToneTransferPhase =
  | "preflight"
  | "placing-blocks"
  | "base-parameters"
  | "scenes"
  | "verifying"
  | "rolling-back"
  | "complete";

export interface QCToneTransferProgress {
  phase: QCToneTransferPhase;
  completed: number;
  total: number;
}

export interface QCToneTransferOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: QCToneTransferProgress) => void;
  /** Only for the explicitly gated hardware-integration test. */
  allowUnverifiedFirmware?: boolean;
}

export interface QCToneTransferResult {
  appliedBlocks: number;
  appliedParameters: number;
  configuredScenes: number;
  firmware: string;
}

export interface QCToneTransferPreflightResult {
  ready: true;
  firmware: string;
  targetCells: readonly string[];
  requiredBlocks: number;
  configuredScenes: number;
}

interface QCToneTransferPreflightContext {
  info: QCSessionInfo;
  plan: QCResolvedTone;
  before: QCGridSnapshot;
  activeScene: number;
  timeoutMs: number;
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveValue(
  specification: QCModelParameter,
  value: string | number | boolean,
): QCGridParameterValue {
  if (typeof value === "number") {
    if (specification.type === "string") {
      throw new QCToneTransferPreflightError(
        `Parameter ${specification.name} requires text, not a 0-100 position`,
      );
    }
    return { kind: "float", value: value / 100 };
  }

  const optionCount = specification.options.length || specification.steps;
  if (typeof value === "boolean") {
    if (optionCount !== 2) {
      throw new QCToneTransferPreflightError(
        `Parameter ${specification.name} is not a two-option switch`,
      );
    }
    return { kind: "float", value: value ? 1 : 0 };
  }

  if (specification.type === "string") {
    return { kind: "string", value };
  }
  if (specification.dynamic) {
    throw new QCToneTransferPreflightError(
      `Parameter ${specification.name} has preset-dependent options and cannot be resolved from ModelRepo alone`,
    );
  }
  const optionIndex = specification.options.findIndex(
    (option) => normalized(option) === normalized(value),
  );
  if (optionIndex === -1 || specification.options.length < 2) {
    throw new QCToneTransferPreflightError(
      `Value ${JSON.stringify(value)} is not a published option for ${specification.name}`,
    );
  }
  return {
    kind: "float",
    value: optionIndex / (specification.options.length - 1),
  };
}

function resolveParameters(
  catalog: QCModelCatalog,
  model: QCModel,
  parameters: Readonly<Record<string, string | number | boolean>>,
  profiles: readonly DeviceParameter[] = [],
): QCResolvedParameter[] {
  return Object.entries(parameters).map(([name, value]) => {
    try {
      const profile = profiles.find(
        (candidate) => normalized(candidate.name) === normalized(name),
      );
      const specification =
        profile?.qcParameterIndex === undefined
          ? catalog.resolveParameter(model, name)
          : model.parameters.find(
              (parameter) => parameter.index === profile.qcParameterIndex,
            );
      if (
        !specification ||
        normalized(specification.name) !== normalized(name)
      ) {
        throw new QCModelCatalogError(
          `Model ${JSON.stringify(model.name)} has no matching parameter ${JSON.stringify(name)} at index ${profile?.qcParameterIndex}`,
        );
      }
      return { name, specification, value: resolveValue(specification, value) };
    } catch (error) {
      if (error instanceof QCToneTransferError) throw error;
      throw new QCToneTransferPreflightError(
        `Cannot resolve ${model.name} parameter ${JSON.stringify(name)}`,
        { cause: error },
      );
    }
  });
}

export function resolveToneForQC(
  candidate: unknown,
  catalog: QCModelCatalog,
): QCResolvedTone {
  const result = tonePresetSchema.safeParse(candidate);
  if (!result.success) {
    throw new QCToneTransferPreflightError(
      "The tone no longer satisfies the validated preset contract",
      { cause: result.error },
    );
  }
  const tone = result.data;
  const blocks = tone.signal_chain.map((block) => {
    const device = getDeviceById(block.device_id);
    if (!device) {
      throw new QCToneTransferPreflightError(
        `Unknown tone device ${block.device_id}`,
      );
    }
    try {
      const model =
        device.qcModelId === undefined
          ? catalog.resolveModel({
              name: block.device_name,
              basedOn: device.basedOn,
            })
          : catalog.get(device.qcModelId);
      if (!model || model.hidden || model.superseded) {
        throw new QCModelCatalogError(
          `Verified factory model ${device.qcModelId ?? block.device_name} is not active in the live catalog`,
        );
      }
      return {
        row: block.row - 1,
        column: block.position - 1,
        model,
        bypassed: block.bypassed,
        parameters: resolveParameters(
          catalog,
          model,
          block.parameters,
          device.parameters,
        ),
      };
    } catch (error) {
      if (error instanceof QCToneTransferError) throw error;
      const detail =
        error instanceof QCModelCatalogError ? `: ${error.message}` : "";
      throw new QCToneTransferPreflightError(
        `Cannot map ${block.device_name} to this Quad Cortex${detail}`,
        { cause: error },
      );
    }
  });
  const blockByLocation = new Map(
    blocks.map((block) => [`${block.row}:${block.column}`, block]),
  );
  const scenes = tone.scenes.map((scene, index) => ({
    index,
    name: scene.name,
    changes: scene.changes.map((change) => {
      const row = change.row - 1;
      const column = change.position - 1;
      const block = blockByLocation.get(`${row}:${column}`)!;
      const source = tone.signal_chain.find(
        (candidate) =>
          candidate.row - 1 === row && candidate.position - 1 === column,
      )!;
      const device = getDeviceById(source.device_id)!;
      return {
        row,
        column,
        parameters: resolveParameters(
          catalog,
          block.model,
          change.parameters ?? {},
          device.parameters,
        ),
      };
    }),
  }));
  return { tone, blocks, scenes };
}

function valuesEqual(
  actual: QCGridParameterValue | undefined,
  expected: QCGridParameterValue,
): boolean {
  if (!actual || actual.kind !== expected.kind) return false;
  if (actual.kind === "string" && expected.kind === "string") {
    return actual.value === expected.value;
  }
  return (
    actual.kind !== "string" &&
    expected.kind !== "string" &&
    Math.abs(actual.value - expected.value) <= 0.000_01
  );
}

function parameterAt(
  block: QCGridBlock | undefined,
  index: number,
): QCGridBlock["parameters"][number] | undefined {
  return block?.parameters.find((parameter) => parameter.index === index);
}

function progress(
  options: QCToneTransferOptions,
  phase: QCToneTransferPhase,
  completed: number,
  total: number,
): void {
  options.onProgress?.({ phase, completed, total });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new QCToneTransferError("Tone transfer was cancelled");
  }
}

async function applyMutation(
  session: QCToneTransferSession,
  payload: Uint8Array,
  echoMatches: (snapshot: QCGridSnapshot) => boolean,
  readbackMatches: (snapshot: QCGridSnapshot) => boolean,
  timeoutMs: number,
): Promise<void> {
  try {
    await session.applyGridMutation(payload, echoMatches, timeoutMs);
  } catch (error) {
    if (!(error instanceof QCSessionTimeoutError)) throw error;
    const snapshot = await session.readCurrentPreset();
    if (!readbackMatches(snapshot)) throw error;
  }
}

function blockMatches(
  snapshot: QCGridSnapshot,
  block: QCResolvedBlock,
): boolean {
  return (
    findGridBlock(snapshot, block.row, block.column)?.modelId === block.model.id
  );
}

async function placeBlock(
  session: QCToneTransferSession,
  block: QCResolvedBlock,
  timeoutMs: number,
): Promise<void> {
  await applyMutation(
    session,
    encodePlaceBlock(block.row, block.column, block.model.id),
    (snapshot) => blockMatches(snapshot, block),
    (snapshot) => blockMatches(snapshot, block),
    timeoutMs,
  );
}

async function setParameter(
  session: QCToneTransferSession,
  block: Pick<QCResolvedBlock, "row" | "column">,
  parameter: QCResolvedParameter,
  activeScene: number,
  timeoutMs: number,
): Promise<void> {
  const matches = (snapshot: QCGridSnapshot, fromReadback: boolean) => {
    const value = parameterAt(
      findGridBlock(snapshot, block.row, block.column),
      parameter.specification.index,
    );
    const index = fromReadback && value?.sceneMode ? activeScene : 0;
    return valuesEqual(value?.values[index], parameter.value);
  };
  await applyMutation(
    session,
    encodeSetBlockParameter(
      block.row,
      block.column,
      parameter.specification.index,
      parameter.value,
    ),
    (snapshot) => matches(snapshot, false),
    (snapshot) => matches(snapshot, true),
    timeoutMs,
  );
}

async function setBypass(
  session: QCToneTransferSession,
  block: Pick<QCResolvedBlock, "row" | "column">,
  bypassed: boolean,
  activeScene: number,
  timeoutMs: number,
): Promise<void> {
  const matches = (snapshot: QCGridSnapshot, fromReadback: boolean) => {
    const bypass = snapshot.bypass.find(
      (value) => value.row === block.row && value.column === block.column,
    );
    const index = fromReadback && bypass?.sceneMode ? activeScene : 0;
    return bypass?.values[index] === bypassed;
  };
  await applyMutation(
    session,
    encodeSetBlockBypass(block.row, block.column, bypassed),
    (snapshot) => matches(snapshot, false),
    (snapshot) => matches(snapshot, true),
    timeoutMs,
  );
}

function sceneParameterKeys(plan: QCResolvedTone): Set<string> {
  const keys = new Set<string>();
  for (const scene of plan.scenes) {
    for (const change of scene.changes) {
      for (const parameter of change.parameters) {
        keys.add(
          `${change.row}:${change.column}:${parameter.specification.index}`,
        );
      }
    }
  }
  return keys;
}

function verifyAppliedTone(
  plan: QCResolvedTone,
  snapshot: QCGridSnapshot,
): boolean {
  for (const block of plan.blocks) {
    const actual = findGridBlock(snapshot, block.row, block.column);
    if (actual?.modelId !== block.model.id) return false;
    for (const parameter of block.parameters) {
      const current = parameterAt(actual, parameter.specification.index);
      const sceneChanges = plan.scenes.map((scene) =>
        scene.changes
          .find(
            (change) =>
              change.row === block.row && change.column === block.column,
          )
          ?.parameters.find(
            (candidate) =>
              candidate.specification.index === parameter.specification.index,
          ),
      );
      if (sceneChanges.some(Boolean)) {
        if (!current?.sceneMode) return false;
        for (let index = 0; index < sceneChanges.length; index += 1) {
          if (
            !valuesEqual(
              current.values[index],
              sceneChanges[index]?.value ?? parameter.value,
            )
          ) {
            return false;
          }
        }
      } else if (!valuesEqual(current?.values[0], parameter.value)) {
        return false;
      }
    }

    const actualBypass = snapshot.bypass.find(
      (value) => value.row === block.row && value.column === block.column,
    );
    if (actualBypass?.values[0] !== block.bypassed) {
      return false;
    }
  }
  return plan.scenes.every(
    (scene) => snapshot.sceneLabels[scene.index]?.trim() === scene.name.trim(),
  );
}

async function rollbackEmptyCells(
  session: QCToneTransferSession,
  plan: QCResolvedTone,
  before: QCGridSnapshot,
  activeScene: number,
  timeoutMs: number,
): Promise<void> {
  const errors: Error[] = [];
  for (const block of [...plan.blocks].reverse()) {
    try {
      await applyMutation(
        session,
        encodeRemoveBlock(block.row, block.column),
        (snapshot) => {
          const value = findGridBlock(snapshot, block.row, block.column);
          return value === undefined || value.modelId === 0;
        },
        (snapshot) => {
          const value = findGridBlock(snapshot, block.row, block.column);
          return value === undefined || value.modelId === 0;
        },
        timeoutMs,
      );
    } catch (error) {
      errors.push(
        error instanceof Error ? error : new Error("Unknown rollback failure"),
      );
    }
  }
  for (const scene of plan.scenes) {
    try {
      await session.setSceneLabel(
        scene.index,
        before.sceneLabels[scene.index] ?? " ",
        timeoutMs,
      );
    } catch (error) {
      errors.push(
        error instanceof Error ? error : new Error("Unknown label rollback failure"),
      );
    }
  }
  try {
    await session.switchScene(activeScene, timeoutMs);
  } catch (error) {
    errors.push(
      error instanceof Error ? error : new Error("Unknown scene rollback failure"),
    );
  }

  try {
    const restored = await session.readCurrentPreset();
    if (
      plan.blocks.some((block) => {
        const value = findGridBlock(restored, block.row, block.column);
        return value !== undefined && value.modelId !== 0;
      })
    ) {
      errors.push(new Error("One or more target cells remained occupied"));
    }
    if (
      plan.scenes.some(
        (scene) =>
          restored.sceneLabels[scene.index] !==
          (before.sceneLabels[scene.index]?.trim()
            ? before.sceneLabels[scene.index]
            : " "),
      )
    ) {
      errors.push(new Error("One or more scene labels were not restored"));
    }
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error
        : new Error("Unknown preset read-back failure"),
    );
  }
  try {
    if ((await session.readActiveScene(timeoutMs)) !== activeScene) {
      errors.push(new Error("The original active scene was not restored"));
    }
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error
        : new Error("Unknown scene read-back failure"),
    );
  }
  if (errors.length > 0) throw errors[0];
}

function transferTimeout(options: QCToneTransferOptions): number {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new QCToneTransferPreflightError(
      "Tone transfer timeout must be between 100 and 30000 milliseconds",
    );
  }
  return timeoutMs;
}

function firmwareLabel(info: QCSessionInfo): string {
  return `${info.version.zenosVersion}/${info.version.appFirmwareVersion}`;
}

async function prepareToneTransfer(
  candidate: unknown,
  session: QCToneTransferSession,
  options: QCToneTransferOptions,
): Promise<QCToneTransferPreflightContext> {
  const timeoutMs = transferTimeout(options);
  throwIfAborted(options.signal);
  const info = session.getInfo();
  if (!info) {
    throw new QCToneTransferPreflightError(
      "The typed Quad Cortex session is not ready",
    );
  }
  if (
    !options.allowUnverifiedFirmware &&
    !QC_TRANSFER_VERIFIED_FIRMWARE.some(
      (firmware) =>
        firmware.zenosVersion === info.version.zenosVersion &&
        firmware.appFirmwareVersion === info.version.appFirmwareVersion,
    )
  ) {
    throw new QCFirmwareCompatibilityError(
      `Preset mutations are not verified for zenos ${info.version.zenosVersion ?? "unknown"} / app ${info.version.appFirmwareVersion ?? "unknown"}`,
    );
  }

  progress(options, "preflight", 0, 1);
  const plan = resolveToneForQC(candidate, info.modelCatalog);
  const before = await session.readCurrentPreset();
  throwIfAborted(options.signal);
  const activeScene = await session.readActiveScene(timeoutMs);
  const occupied = plan.blocks.filter((block) => {
    const current = findGridBlock(before, block.row, block.column);
    return current !== undefined && current.modelId !== 0;
  });
  if (occupied.length > 0) {
    throw new QCToneTransferPreflightError(
      `Target cells are occupied (${occupied.map((block) => `${block.row + 1}.${block.column + 1}`).join(", ")}). Load an empty preset before applying this tone.`,
    );
  }
  progress(options, "preflight", 1, 1);
  return { info, plan, before, activeScene, timeoutMs };
}

/**
 * Performs every read-only validation required immediately before a transfer.
 * The mutating transaction repeats this preflight to close the time-of-check /
 * time-of-use gap after the user confirms.
 */
export async function preflightToneForCurrentGrid(
  candidate: unknown,
  session: QCToneTransferSession,
  options: QCToneTransferOptions = {},
): Promise<QCToneTransferPreflightResult> {
  const { info, plan } = await prepareToneTransfer(candidate, session, options);
  progress(options, "complete", 1, 1);
  return {
    ready: true,
    firmware: firmwareLabel(info),
    targetCells: plan.blocks.map(
      (block) => `${block.row + 1}.${block.column + 1}`,
    ),
    requiredBlocks: plan.blocks.length,
    configuredScenes: plan.scenes.length,
  };
}

export async function applyToneToCurrentGrid(
  candidate: unknown,
  session: QCToneTransferSession,
  options: QCToneTransferOptions = {},
): Promise<QCToneTransferResult> {
  const { info, plan, before, activeScene, timeoutMs } =
    await prepareToneTransfer(candidate, session, options);

  let mutated = false;
  try {
    progress(options, "placing-blocks", 0, plan.blocks.length);
    for (let index = 0; index < plan.blocks.length; index += 1) {
      throwIfAborted(options.signal);
      // From this point onward the device may have accepted the write even if
      // its echo or subsequent read-back is lost. Always attempt rollback.
      mutated = true;
      await placeBlock(session, plan.blocks[index], timeoutMs);
      progress(options, "placing-blocks", index + 1, plan.blocks.length);
    }

    const parameterCount = plan.blocks.reduce(
      (count, block) => count + block.parameters.length + 1,
      0,
    );
    let configured = 0;
    progress(options, "base-parameters", configured, parameterCount);
    for (const block of plan.blocks) {
      for (const parameter of block.parameters) {
        throwIfAborted(options.signal);
        await setParameter(
          session,
          block,
          parameter,
          activeScene,
          timeoutMs,
        );
        configured += 1;
        progress(options, "base-parameters", configured, parameterCount);
      }
      throwIfAborted(options.signal);
      await setBypass(
        session,
        block,
        block.bypassed,
        activeScene,
        timeoutMs,
      );
      configured += 1;
      progress(options, "base-parameters", configured, parameterCount);
    }

    const promoted = sceneParameterKeys(plan);
    for (const key of promoted) {
      throwIfAborted(options.signal);
      const [row, column, parameterIndex] = key.split(":").map(Number);
      await applyMutation(
        session,
        encodeSetParameterSceneMode(row, column, parameterIndex, true),
        (snapshot) =>
          parameterAt(findGridBlock(snapshot, row, column), parameterIndex)
            ?.sceneMode === true,
        (snapshot) =>
          parameterAt(findGridBlock(snapshot, row, column), parameterIndex)
            ?.sceneMode === true,
        timeoutMs,
      );
    }

    progress(options, "scenes", 0, plan.scenes.length);
    for (const scene of plan.scenes) {
      throwIfAborted(options.signal);
      await session.switchScene(scene.index, timeoutMs);
      await session.setSceneLabel(scene.index, scene.name, timeoutMs);
      for (const change of scene.changes) {
        for (const parameter of change.parameters) {
          throwIfAborted(options.signal);
          await setParameter(
            session,
            change,
            parameter,
            scene.index,
            timeoutMs,
          );
        }
      }
      progress(options, "scenes", scene.index + 1, plan.scenes.length);
    }
    await session.switchScene(activeScene, timeoutMs);

    progress(options, "verifying", 0, 1);
    const finalSnapshot = await session.readCurrentPreset();
    if (!verifyAppliedTone(plan, finalSnapshot)) {
      throw new QCToneTransferError(
        "Quad Cortex read-back did not match the complete tone plan",
      );
    }
    progress(options, "verifying", 1, 1);
    progress(options, "complete", 1, 1);
    return {
      appliedBlocks: plan.blocks.length,
      appliedParameters: plan.blocks.reduce(
        (count, block) => count + block.parameters.length,
        0,
      ),
      configuredScenes: plan.scenes.length,
      firmware: firmwareLabel(info),
    };
  } catch (error) {
    const applyError =
      error instanceof Error
        ? error
        : new QCToneTransferError("Unknown tone transfer failure");
    if (!mutated) throw applyError;
    progress(options, "rolling-back", 0, 1);
    try {
      await rollbackEmptyCells(
        session,
        plan,
        before,
        activeScene,
        timeoutMs,
      );
      progress(options, "rolling-back", 1, 1);
    } catch (rollbackError) {
      throw new QCToneTransferRollbackError(
        applyError,
        rollbackError instanceof Error
          ? rollbackError
          : new Error("Unknown rollback failure"),
      );
    }
    if (applyError instanceof QCSessionError) {
      throw new QCToneTransferError("Quad Cortex tone apply failed", {
        cause: applyError,
      });
    }
    throw applyError;
  }
}
