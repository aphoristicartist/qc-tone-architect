import {
  decodeProtobufFields,
  encodeBytesField,
  encodeStringField,
  encodeVarintField,
  firstBytes,
  firstString,
  firstVarint,
  type QCProtobufFields,
} from "./protobuf-wire";

export const QC_MESSAGE_TYPE = {
  grid: 1,
  setlistPosition: 2,
  ioSettings: 3,
  file: 4,
  generalSettings: 9,
  version: 10,
  scene: 13,
  mode: 14,
  recallPreset: 15,
  masterVolume: 17,
  defaultParameters: 19,
  recentsFavorites: 20,
  undoRedo: 21,
  sceneLabel: 23,
  showGigView: 24,
  keepAlive: 32,
  globalTempo: 33,
  presetDirty: 34,
  moduleStats: 35,
  globalEQ: 38,
  compilerInhibitedModules: 42,
  connection: 49,
  newModels: 50,
  modelRepo: 51,
  resetCommsBuffers: 52,
  pinnedModels: 54,
  bulkOperation: 57,
  license: 58,
  updater: 60,
} as const;

export type QCMessageType =
  (typeof QC_MESSAGE_TYPE)[keyof typeof QC_MESSAGE_TYPE];

export const QC_MESSAGE_ACTION = {
  create: 0,
  update: 1,
  delete: 2,
  read: 3,
  move: 4,
  copy: 5,
  upload: 6,
  download: 7,
  swap: 8,
} as const;

export interface QCVersionInfo {
  action?: number;
  requestId?: bigint;
  linuxKernelVersion?: string;
  zenosVersion?: string;
  wirelessFirmwareVersion?: string;
  ubootVersion?: string;
  appFirmwareVersion?: string;
  bootloaderFirmwareVersion?: string;
  serialNumber?: string;
  commsVersion?: Buffer;
  cortexControlVersion?: string;
  deviceType?: number;
  cortexControlVersionValid?: boolean;
  customName?: string;
  macAddress?: string;
}

export interface QCDecodedMessage {
  messageType: number;
  payload: Buffer;
  fields: QCProtobufFields;
  action?: number;
  requestId?: bigint;
  connected?: boolean;
  sessionId?: string;
  version?: QCVersionInfo;
  modelRepoPayload?: Buffer;
  binaryPresetPayload?: Buffer;
  selectedScene?: number;
  sceneIndex?: number;
  sceneLabel?: string;
}

const REQUEST_ID_FIELD_ONE = new Set<number>([
  QC_MESSAGE_TYPE.connection,
  QC_MESSAGE_TYPE.resetCommsBuffers,
]);

const TYPES_WITHOUT_ACTION = new Set<number>([
  QC_MESSAGE_TYPE.connection,
  QC_MESSAGE_TYPE.resetCommsBuffers,
]);

function optionalNumber(value: bigint | undefined): number | undefined {
  if (value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  return Number(value);
}

function decodeVersion(fields: QCProtobufFields): QCVersionInfo {
  const valid = firstVarint(fields, 14);
  return {
    action: optionalNumber(firstVarint(fields, 1)),
    requestId: firstVarint(fields, 2),
    linuxKernelVersion: firstString(fields, 3),
    zenosVersion: firstString(fields, 4),
    wirelessFirmwareVersion: firstString(fields, 5),
    ubootVersion: firstString(fields, 6),
    appFirmwareVersion: firstString(fields, 7),
    bootloaderFirmwareVersion: firstString(fields, 8),
    serialNumber: firstString(fields, 9),
    commsVersion: firstBytes(fields, 10),
    cortexControlVersion: firstString(fields, 11),
    deviceType: optionalNumber(firstVarint(fields, 12)),
    cortexControlVersionValid:
      valid === undefined ? undefined : valid !== BigInt(0),
    customName: firstString(fields, 15),
    macAddress: firstString(fields, 16),
  };
}

export function decodeTypedMessage(
  messageType: number,
  payload: Uint8Array,
): QCDecodedMessage {
  const fields = decodeProtobufFields(payload);
  const action = TYPES_WITHOUT_ACTION.has(messageType)
    ? undefined
    : optionalNumber(firstVarint(fields, 1));
  const requestId = firstVarint(
    fields,
    REQUEST_ID_FIELD_ONE.has(messageType) ? 1 : 2,
  );
  const connectedValue =
    messageType === QC_MESSAGE_TYPE.connection
      ? firstVarint(fields, 2)
      : undefined;

  return {
    messageType,
    payload: Buffer.from(payload),
    fields,
    action,
    requestId,
    connected:
      connectedValue === undefined
        ? undefined
        : connectedValue !== BigInt(0),
    sessionId:
      messageType === QC_MESSAGE_TYPE.resetCommsBuffers
        ? firstString(fields, 2)
        : undefined,
    version:
      messageType === QC_MESSAGE_TYPE.version
        ? decodeVersion(fields)
        : undefined,
    modelRepoPayload:
      messageType === QC_MESSAGE_TYPE.modelRepo
        ? firstBytes(fields, 3)
        : undefined,
    binaryPresetPayload:
      messageType === QC_MESSAGE_TYPE.grid ||
      messageType === QC_MESSAGE_TYPE.recallPreset
        ? firstBytes(fields, 3)
        : undefined,
    selectedScene:
      messageType === QC_MESSAGE_TYPE.scene
        ? optionalNumber(firstVarint(fields, 3))
        : undefined,
    sceneIndex:
      messageType === QC_MESSAGE_TYPE.sceneLabel
        ? optionalNumber(firstVarint(fields, 3))
        : undefined,
    sceneLabel:
      messageType === QC_MESSAGE_TYPE.sceneLabel
        ? firstString(fields, 4)
        : undefined,
  };
}

export function encodeActionMessage(
  action: number,
  requestId?: bigint,
): Buffer {
  return Buffer.concat([
    encodeVarintField(1, action),
    ...(requestId === undefined ? [] : [encodeVarintField(2, requestId)]),
  ]);
}

export function encodeResetCommsBuffers(
  sessionId: string,
  requestId = BigInt(0),
): Buffer {
  if (!/^[a-f0-9]{32}$/.test(sessionId)) {
    throw new Error("QC session ID must contain exactly 32 lowercase hex digits");
  }
  return Buffer.concat([
    encodeVarintField(1, requestId),
    encodeStringField(2, sessionId),
  ]);
}

export function encodeVersionAnnouncement(
  cortexControlVersion: string,
): Buffer {
  return Buffer.concat([
    encodeVarintField(1, QC_MESSAGE_ACTION.update),
    encodeStringField(11, cortexControlVersion),
  ]);
}

export function encodeConnection(connected: boolean): Buffer {
  return encodeVarintField(2, connected);
}

export function encodeModelRepoResponse(payload: Uint8Array): Buffer {
  return Buffer.concat([
    encodeVarintField(1, QC_MESSAGE_ACTION.read),
    encodeBytesField(3, payload),
  ]);
}
