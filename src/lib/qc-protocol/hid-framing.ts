export const QC_HID_INPUT_REPORT_ID = 0x01;
export const QC_HID_OUTPUT_REPORT_ID = 0x02;
export const QC_HID_REPORT_SIZE = 129;
export const QC_HID_PAYLOAD_SIZE = 126;
export const QC_MAX_MESSAGE_SIZE = 1024 * 1024;

const FIRST_REPORT_FLAG = 0x40;
const LAST_REPORT_FLAG = 0x80;
const KNOWN_FLAGS = FIRST_REPORT_FLAG | LAST_REPORT_FLAG;

export class QCHIDFramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QCHIDFramingError";
  }
}

/**
 * Splits one complete protocol message into the fixed-size HID reports used by
 * Cortex Control 4.0.1. Reports have this format:
 *
 * [0x02 report id][payload length][0x40 first | 0x80 last][payload][zero padding]
 */
export function encodeHIDReports(message: Uint8Array): Buffer[] {
  const reports: Buffer[] = [];
  const reportCount = Math.max(
    1,
    Math.ceil(message.byteLength / QC_HID_PAYLOAD_SIZE),
  );

  for (let index = 0; index < reportCount; index += 1) {
    const offset = index * QC_HID_PAYLOAD_SIZE;
    const payload = message.subarray(offset, offset + QC_HID_PAYLOAD_SIZE);
    const first = index === 0;
    const last = index === reportCount - 1;
    const report = Buffer.alloc(QC_HID_REPORT_SIZE);
    report[0] = QC_HID_OUTPUT_REPORT_ID;
    report[1] = payload.byteLength;
    report[2] =
      (first ? FIRST_REPORT_FLAG : 0) | (last ? LAST_REPORT_FLAG : 0);
    report.set(payload, 3);
    reports.push(report);
  }

  return reports;
}

/** Reassembles HID reports and emits a message only after its final report. */
export class HIDReportAssembler {
  private chunks: Buffer[] = [];
  private receiving = false;
  private size = 0;

  constructor(
    private readonly reportId: number = QC_HID_INPUT_REPORT_ID,
    private readonly maximumMessageSize: number = QC_MAX_MESSAGE_SIZE,
  ) {
    if (!Number.isInteger(reportId) || reportId < 0 || reportId > 0xff) {
      throw new QCHIDFramingError("Report ID must be an unsigned byte");
    }
    if (!Number.isSafeInteger(maximumMessageSize) || maximumMessageSize < 1) {
      throw new QCHIDFramingError("Maximum message size must be positive");
    }
  }

  push(report: Uint8Array): Buffer | null {
    if (report.byteLength !== QC_HID_REPORT_SIZE) {
      return this.fail(
        `Expected a ${QC_HID_REPORT_SIZE}-byte report, received ${report.byteLength}`,
      );
    }
    if (report[0] !== this.reportId) {
      return this.fail(`Unexpected report ID 0x${report[0].toString(16)}`);
    }

    const payloadLength = report[1];
    const flags = report[2];
    if (payloadLength > QC_HID_PAYLOAD_SIZE) {
      return this.fail(`Invalid HID payload length ${payloadLength}`);
    }
    if ((flags & ~KNOWN_FLAGS) !== 0) {
      return this.fail(`Unknown HID report flags 0x${flags.toString(16)}`);
    }

    const first = (flags & FIRST_REPORT_FLAG) !== 0;
    const last = (flags & LAST_REPORT_FLAG) !== 0;

    if (first) {
      this.chunks = [];
      this.receiving = true;
      this.size = 0;
    } else if (!this.receiving) {
      return this.fail("Received a continuation report before a first report");
    }

    if (!last && payloadLength !== QC_HID_PAYLOAD_SIZE) {
      return this.fail(
        `Non-final HID report must contain ${QC_HID_PAYLOAD_SIZE} payload bytes`,
      );
    }

    this.size += payloadLength;
    if (this.size > this.maximumMessageSize) {
      return this.fail(
        `Reassembled HID message exceeds ${this.maximumMessageSize} bytes`,
      );
    }
    this.chunks.push(Buffer.from(report.subarray(3, 3 + payloadLength)));

    if (!last) return null;
    const message = Buffer.concat(this.chunks);
    this.reset();
    return message;
  }

  reset(): void {
    this.chunks = [];
    this.receiving = false;
    this.size = 0;
  }

  private fail(message: string): never {
    this.reset();
    throw new QCHIDFramingError(message);
  }
}
