import { describe, expect, it } from "vitest";

import { firstBytes, decodeProtobufFields } from "./protobuf-wire";
import {
  decodeBinaryPreset,
  encodePlaceBlock,
  encodeRemoveBlock,
  encodeSetBlockBypass,
  encodeSetBlockParameter,
  encodeSetParameterSceneMode,
  QCGridMessageError,
} from "./grid-messages";
import { decodeTypedMessage, QC_MESSAGE_TYPE } from "./typed-messages";

function binaryPreset(gridPayload: Buffer): Buffer {
  return firstBytes(decodeProtobufFields(gridPayload), 3)!;
}

describe("sparse Quad Cortex grid messages", () => {
  it("encodes and decodes keyed block placement", () => {
    const grid = encodePlaceBlock(2, 5, 1139);
    const decoded = decodeTypedMessage(QC_MESSAGE_TYPE.grid, grid);

    expect(decoded.action).toBe(1);
    expect(decodeBinaryPreset(decoded.binaryPresetPayload!)).toMatchObject({
      blocks: [{ row: 2, column: 5, modelId: 1139 }],
    });
  });

  it("uses DELETE plus hash zero for removal", () => {
    const decoded = decodeTypedMessage(
      QC_MESSAGE_TYPE.grid,
      encodeRemoveBlock(0, 7),
    );

    expect(decoded.action).toBe(2);
    expect(decodeBinaryPreset(decoded.binaryPresetPayload!).blocks[0]).toMatchObject(
      { row: 0, column: 7, modelId: 0 },
    );
  });

  it("round trips float, string, scene-mode, and bypass mutations", () => {
    expect(
      decodeBinaryPreset(binaryPreset(encodeSetBlockParameter(0, 1, 4, 0.625)))
        .blocks[0].parameters[0],
    ).toMatchObject({
      index: 4,
      values: [{ kind: "float", value: expect.closeTo(0.625) }],
    });
    expect(
      decodeBinaryPreset(binaryPreset(encodeSetBlockParameter(0, 1, 5, "57")))
        .blocks[0].parameters[0],
    ).toMatchObject({
      index: 5,
      values: [{ kind: "string", value: "57" }],
    });
    expect(
      decodeBinaryPreset(binaryPreset(encodeSetParameterSceneMode(0, 1, 5, true)))
        .blocks[0].parameters[0],
    ).toMatchObject({ index: 5, sceneMode: true, values: [] });
    expect(
      decodeBinaryPreset(binaryPreset(encodeSetBlockBypass(3, 7, true))).bypass,
    ).toEqual([{ row: 3, column: 7, sceneMode: undefined, values: [true] }]);
  });

  it.each([
    () => encodePlaceBlock(-1, 0, 1),
    () => encodePlaceBlock(0, 8, 1),
    () => encodePlaceBlock(0, 0, -1),
    () => encodeSetBlockParameter(0, 0, 1, 1.1),
    () => encodeSetBlockParameter(0, 0, 1, ""),
  ])("refuses unsafe grid mutation input", (operation) => {
    expect(operation).toThrow(QCGridMessageError);
  });
});
