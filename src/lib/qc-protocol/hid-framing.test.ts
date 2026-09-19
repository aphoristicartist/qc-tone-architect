import { describe, expect, it } from "vitest";

import {
  encodeHIDReports,
  HIDReportAssembler,
  QC_HID_PAYLOAD_SIZE,
  QC_HID_INPUT_REPORT_ID,
  QC_HID_OUTPUT_REPORT_ID,
  QC_HID_REPORT_SIZE,
  QCHIDFramingError,
} from "./hid-framing";

describe("Quad Cortex HID framing", () => {
  it.each([0, 1, 125, 126, 127, 251, 252, 253, 1_024])(
    "round trips a %i-byte message",
    (length) => {
      const message = Buffer.from(
        Array.from({ length }, (_, index) => index % 251),
      );
      const reports = encodeHIDReports(message);
      const assembler = new HIDReportAssembler(QC_HID_OUTPUT_REPORT_ID);
      let decoded: Buffer | null = null;

      for (const report of reports) {
        expect(report).toHaveLength(QC_HID_REPORT_SIZE);
        expect(report[0]).toBe(QC_HID_OUTPUT_REPORT_ID);
        decoded = assembler.push(report);
      }

      expect(decoded).toEqual(message);
      expect(reports).toHaveLength(
        Math.max(1, Math.ceil(length / QC_HID_PAYLOAD_SIZE)),
      );
      expect(reports[0][2] & 0x40).toBe(0x40);
      expect(reports.at(-1)![2] & 0x80).toBe(0x80);
    },
  );

  it("rejects malformed and out-of-order reports", () => {
    const assembler = new HIDReportAssembler();
    expect(() => assembler.push(Buffer.alloc(12))).toThrow(QCHIDFramingError);

    const continuation = Buffer.alloc(QC_HID_REPORT_SIZE);
    continuation[0] = QC_HID_INPUT_REPORT_ID;
    expect(() => assembler.push(continuation)).toThrow(
      "continuation report before a first report",
    );

    const invalidLength = Buffer.alloc(QC_HID_REPORT_SIZE);
    invalidLength[0] = QC_HID_INPUT_REPORT_ID;
    invalidLength[1] = 127;
    invalidLength[2] = 0xc0;
    expect(() => assembler.push(invalidLength)).toThrow(
      "Invalid HID payload length",
    );
  });

  it("accepts inbound report ID 0x01 and enforces the reassembly bound", () => {
    const inbound = Buffer.alloc(QC_HID_REPORT_SIZE);
    inbound[0] = QC_HID_INPUT_REPORT_ID;
    inbound[1] = 2;
    inbound[2] = 0xc0;
    inbound.set([0xaa, 0xbb], 3);
    expect(new HIDReportAssembler().push(inbound)).toEqual(
      Buffer.from([0xaa, 0xbb]),
    );

    const bounded = new HIDReportAssembler(QC_HID_INPUT_REPORT_ID, 1);
    expect(() => bounded.push(inbound)).toThrow("exceeds 1 bytes");
  });

  it("drops an incomplete message when a new first report arrives", () => {
    const reports = encodeHIDReports(new Uint8Array(136).fill(0x22));
    const assembler = new HIDReportAssembler(QC_HID_OUTPUT_REPORT_ID, 200);

    expect(assembler.push(reports[0])).toBeNull();
    expect(assembler.push(reports[0])).toBeNull();
    expect(assembler.push(reports[1])).toEqual(Buffer.alloc(136, 0x22));
  });
});
