import {
  allBytes,
  decodeProtobufFields,
  encodeBytesField,
  encodeFloatField,
  encodeInt32Field,
  encodeStringField,
  encodeVarintField,
  firstFloat,
  firstString,
  firstVarint,
} from "./protobuf-wire";
import { QC_MESSAGE_ACTION } from "./typed-messages";

export type QCGridParameterValue =
  | { kind: "float"; value: number }
  | { kind: "int"; value: number }
  | { kind: "string"; value: string };

export type QCGridWritableParameterValue =
  | number
  | string
  | QCGridParameterValue;

export interface QCGridParameter {
  index: number;
  sceneMode?: boolean;
  values: readonly QCGridParameterValue[];
}

export interface QCGridBlock {
  row: number;
  column: number;
  /** Omitted on sparse parameter echoes, present on full preset snapshots. */
  modelId?: number;
  parameters: readonly QCGridParameter[];
}

export interface QCGridBypass {
  row: number;
  column: number;
  sceneMode?: boolean;
  values: readonly boolean[];
}

export interface QCGridSnapshot {
  name?: string;
  defaultScene?: number;
  sceneLabels: readonly string[];
  blocks: readonly QCGridBlock[];
  bypass: readonly QCGridBypass[];
}

export class QCGridMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QCGridMessageError";
  }
}

function gridCoordinate(row: number, column: number): void {
  if (!Number.isInteger(row) || row < 0 || row > 3) {
    throw new QCGridMessageError("Grid row must be between 0 and 3");
  }
  if (!Number.isInteger(column) || column < 0 || column > 7) {
    throw new QCGridMessageError("Grid column must be between 0 and 7");
  }
}

function unsigned32(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new QCGridMessageError(`${name} must be an unsigned 32-bit integer`);
  }
}

function nested(fieldNumber: number, parts: readonly Uint8Array[]): Buffer {
  return encodeBytesField(
    fieldNumber,
    Buffer.concat(parts.map((part) => Buffer.from(part))),
  );
}

function gridMessage(action: number, binaryPreset: Uint8Array): Buffer {
  return Buffer.concat([
    encodeVarintField(1, action),
    encodeBytesField(3, binaryPreset),
  ]);
}

function blockContainer(
  row: number,
  column: number,
  modelParts: readonly Uint8Array[],
): Buffer {
  gridCoordinate(row, column);
  const model = Buffer.concat([
    ...modelParts.map((part) => Buffer.from(part)),
    encodeVarintField(5, column),
  ]);
  const chain = Buffer.concat([
    nested(5, [model]),
    encodeVarintField(14, row),
  ]);
  return nested(11, [chain]);
}

export function encodePlaceBlock(
  row: number,
  column: number,
  modelId: number,
): Buffer {
  unsigned32("Model ID", modelId);
  return gridMessage(
    QC_MESSAGE_ACTION.update,
    blockContainer(row, column, [encodeVarintField(1, modelId)]),
  );
}

export function encodeRemoveBlock(row: number, column: number): Buffer {
  return gridMessage(
    QC_MESSAGE_ACTION.delete,
    blockContainer(row, column, [encodeVarintField(1, 0)]),
  );
}

function parameterValue(value: QCGridParameterValue): Buffer {
  const encoded =
    value.kind === "string"
      ? encodeStringField(3, value.value)
      : value.kind === "int"
        ? encodeInt32Field(1, value.value)
        : encodeFloatField(2, value.value);
  return nested(5, [encoded]);
}

function writableValue(
  value: QCGridWritableParameterValue,
): QCGridParameterValue {
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "number") return { kind: "float", value };
  return value;
}

export function encodeSetBlockParameter(
  row: number,
  column: number,
  parameterIndex: number,
  value: QCGridWritableParameterValue,
): Buffer {
  unsigned32("Parameter index", parameterIndex);
  const wireValue = writableValue(value);
  if (
    wireValue.kind === "float" &&
    (!Number.isFinite(wireValue.value) ||
      wireValue.value < 0 ||
      wireValue.value > 1)
  ) {
    throw new QCGridMessageError(
      "Encoded parameter values must be between 0 and 1",
    );
  }
  if (
    wireValue.kind === "string" &&
    (wireValue.value.length > 1_024 ||
      (typeof value === "string" && !wireValue.value.trim()))
  ) {
    throw new QCGridMessageError(
      "String parameter values must contain 1 to 1024 characters",
    );
  }
  const parameter = Buffer.concat([
    parameterValue(wireValue),
    encodeVarintField(6, parameterIndex),
  ]);
  return gridMessage(
    QC_MESSAGE_ACTION.update,
    blockContainer(row, column, [nested(2, [parameter])]),
  );
}

export function encodeSetParameterSceneMode(
  row: number,
  column: number,
  parameterIndex: number,
  enabled: boolean,
): Buffer {
  unsigned32("Parameter index", parameterIndex);
  const parameter = Buffer.concat([
    encodeVarintField(4, enabled),
    encodeVarintField(6, parameterIndex),
  ]);
  return gridMessage(
    QC_MESSAGE_ACTION.update,
    blockContainer(row, column, [nested(2, [parameter])]),
  );
}

export function encodeSetBlockBypass(
  row: number,
  column: number,
  bypassed: boolean,
): Buffer {
  gridCoordinate(row, column);
  const sceneBypass = nested(1, [encodeVarintField(1, bypassed)]);
  const columnBypass = Buffer.concat([
    sceneBypass,
    encodeVarintField(2, column),
  ]);
  const bypass = Buffer.concat([
    nested(1, [columnBypass]),
    encodeVarintField(2, row),
  ]);
  return gridMessage(QC_MESSAGE_ACTION.update, nested(18, [bypass]));
}

function asNumber(value: bigint | undefined): number | undefined {
  if (value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  return Number(value);
}

function decodeParameterValue(payload: Buffer): QCGridParameterValue | undefined {
  const fields = decodeProtobufFields(payload);
  const float = firstFloat(fields, 2);
  if (float !== undefined) return { kind: "float", value: float };
  const text = firstString(fields, 3);
  if (text !== undefined) return { kind: "string", value: text };
  const integer = firstVarint(fields, 1);
  return integer === undefined
    ? undefined
    : { kind: "int", value: Number(BigInt.asIntN(32, integer)) };
}

function decodeParameter(payload: Buffer, fallbackIndex: number): QCGridParameter {
  const fields = decodeProtobufFields(payload);
  const sceneMode = firstVarint(fields, 4);
  return {
    index: asNumber(firstVarint(fields, 6)) ?? fallbackIndex,
    sceneMode: sceneMode === undefined ? undefined : sceneMode !== BigInt(0),
    values: allBytes(fields, 5)
      .map(decodeParameterValue)
      .filter((value): value is QCGridParameterValue => value !== undefined),
  };
}

function decodeBlock(
  payload: Buffer,
  row: number,
  fallbackColumn: number,
): QCGridBlock | undefined {
  const fields = decodeProtobufFields(payload);
  const modelId = asNumber(firstVarint(fields, 1));
  return {
    row,
    column: asNumber(firstVarint(fields, 5)) ?? fallbackColumn,
    modelId,
    parameters: allBytes(fields, 2).map(decodeParameter),
  };
}

function decodeBypass(payload: Buffer, fallbackRow: number): QCGridBypass[] {
  const fields = decodeProtobufFields(payload);
  const row = asNumber(firstVarint(fields, 2)) ?? fallbackRow;
  return allBytes(fields, 1).map((columnPayload, fallbackColumn) => {
    const columnFields = decodeProtobufFields(columnPayload);
    const sceneMode = firstVarint(columnFields, 3);
    return {
      row,
      column: asNumber(firstVarint(columnFields, 2)) ?? fallbackColumn,
      sceneMode:
        sceneMode === undefined ? undefined : sceneMode !== BigInt(0),
      values: allBytes(columnFields, 1).map((scenePayload) => {
        const bypass = firstVarint(decodeProtobufFields(scenePayload), 1);
        return bypass !== undefined && bypass !== BigInt(0);
      }),
    };
  });
}

export function decodeBinaryPreset(payload: Uint8Array): QCGridSnapshot {
  const fields = decodeProtobufFields(payload);
  const blocks = allBytes(fields, 11).flatMap((chainPayload, fallbackRow) => {
    const chainFields = decodeProtobufFields(chainPayload);
    const row = asNumber(firstVarint(chainFields, 14)) ?? fallbackRow;
    return allBytes(chainFields, 5)
      .map((modelPayload, fallbackColumn) =>
        decodeBlock(modelPayload, row, fallbackColumn),
      )
      .filter((block): block is QCGridBlock => block !== undefined);
  });
  const bypass = allBytes(fields, 18).flatMap(decodeBypass);
  return {
    name: firstString(fields, 2),
    defaultScene: asNumber(firstVarint(fields, 7)),
    sceneLabels: allBytes(fields, 15).map((value) => value.toString("utf8")),
    blocks,
    bypass,
  };
}

export function findGridBlock(
  snapshot: QCGridSnapshot,
  row: number,
  column: number,
): QCGridBlock | undefined {
  return snapshot.blocks.find(
    (block) => block.row === row && block.column === column,
  );
}
