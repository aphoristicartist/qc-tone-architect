import { describe, expect, it } from "vitest";

import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  QCMessageEnvelopeError,
} from "./message-envelope";

describe("Quad Cortex protocol message envelope", () => {
  it("matches the captured Cortex Control Version READ body", () => {
    const message = encodeProtocolMessage(10, Uint8Array.of(0x08, 0x03));
    expect(message.toString("hex")).toBe("08030a00000000000000");
    expect(decodeProtocolMessage(message)).toEqual({
      messageType: 10,
      payload: Buffer.from([0x08, 0x03]),
      metadata: Buffer.alloc(6),
    });
  });

  it("retains but does not interpret device trailer metadata", () => {
    const message = Buffer.from("08010d00000000003412", "hex");
    expect(decodeProtocolMessage(message)).toEqual({
      messageType: 13,
      payload: Buffer.from([0x08, 0x01]),
      metadata: Buffer.from([0, 0, 0, 0, 0x34, 0x12]),
    });
  });

  it("rejects malformed messages and type values", () => {
    expect(() => decodeProtocolMessage(Buffer.alloc(7))).toThrow(
      QCMessageEnvelopeError,
    );
    expect(() => encodeProtocolMessage(-1, Buffer.alloc(0))).toThrow(
      "unsigned 16-bit integer",
    );
  });
});
