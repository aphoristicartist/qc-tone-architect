import { describe, expect, it } from "vitest";

import {
  decodeProtobufFields,
  encodeBytesField,
  encodeVarintField,
  firstBytes,
  firstVarint,
  QCProtobufError,
} from "./protobuf-wire";

describe("minimal Quad Cortex protobuf wire codec", () => {
  it("round trips uint64 and length-delimited fields", () => {
    const maximumUint64 = (BigInt(1) << BigInt(64)) - BigInt(1);
    const payload = Buffer.concat([
      encodeVarintField(1, maximumUint64),
      encodeBytesField(3, Buffer.from("catalog")),
    ]);
    const fields = decodeProtobufFields(payload);

    expect(firstVarint(fields, 1)).toBe(maximumUint64);
    expect(firstBytes(fields, 3)).toEqual(Buffer.from("catalog"));
  });

  it("preserves repeated fields in wire order", () => {
    const fields = decodeProtobufFields(
      Buffer.concat([encodeVarintField(2, 3), encodeVarintField(2, 4)]),
    );

    expect(fields.get(2)).toEqual([
      { wireType: 0, value: BigInt(3) },
      { wireType: 0, value: BigInt(4) },
    ]);
  });

  it.each([
    Buffer.from([0x08, 0x80]),
    Buffer.from([0x0a, 0x02, 0x01]),
    Buffer.from([0x0b]),
    Buffer.from([0x00]),
  ])("rejects malformed payload %#", (payload) => {
    expect(() => decodeProtobufFields(payload)).toThrow(QCProtobufError);
  });
});
