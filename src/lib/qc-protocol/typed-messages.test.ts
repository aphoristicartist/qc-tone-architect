import { describe, expect, it } from "vitest";

import { encodeVarintField } from "./protobuf-wire";
import {
  decodeTypedMessage,
  encodeConnection,
  encodeResetCommsBuffers,
  QC_MESSAGE_TYPE,
} from "./typed-messages";

describe("typed Quad Cortex protocol messages", () => {
  it("matches the captured ResetCommsBuffers protobuf", () => {
    const sessionId = "792f08bad8664fb9ade88b6317c3c54f";

    expect(encodeResetCommsBuffers(sessionId).toString("hex")).toBe(
      `08001220${Buffer.from(sessionId).toString("hex")}`,
    );
    expect(
      decodeTypedMessage(
        QC_MESSAGE_TYPE.resetCommsBuffers,
        encodeResetCommsBuffers(sessionId),
      ),
    ).toMatchObject({ requestId: BigInt(0), sessionId });
  });

  it("decodes captured Version field numbers without a generated schema", () => {
    const capturedFields = Buffer.from(
      "08012205342e302e313a04643134654a095141303045453931306000",
      "hex",
    );

    expect(
      decodeTypedMessage(QC_MESSAGE_TYPE.version, capturedFields).version,
    ).toMatchObject({
      action: 1,
      zenosVersion: "4.0.1",
      appFirmwareVersion: "d14e",
      serialNumber: "QA00EE910",
      deviceType: 0,
    });
  });

  it("preserves optional false in Connection and Version messages", () => {
    expect(
      decodeTypedMessage(
        QC_MESSAGE_TYPE.connection,
        encodeConnection(false),
      ).connected,
    ).toBe(false);
    expect(
      decodeTypedMessage(
        QC_MESSAGE_TYPE.version,
        Buffer.concat([encodeVarintField(1, 1), encodeVarintField(14, false)]),
      ).version?.cortexControlVersionValid,
    ).toBe(false);
  });
});
