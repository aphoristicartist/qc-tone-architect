import { QCConnection } from "./qc-protocol/qc-connection";
import { QCSession } from "./qc-protocol/session";
import {
  applyToneToCurrentGrid,
  preflightToneForCurrentGrid,
  type QCToneTransferOptions,
  type QCToneTransferPreflightResult,
  type QCToneTransferResult,
} from "./qc-protocol/tone-transfer";
import type { TonePreset } from "./types";

export class QCOperationInProgressError extends Error {
  constructor() {
    super("Another Quad Cortex operation is already running");
    this.name = "QCOperationInProgressError";
  }
}

let operationInProgress = false;

async function withConnectedQC<T>(
  operation: (session: QCSession) => Promise<T>,
): Promise<T> {
  if (operationInProgress) throw new QCOperationInProgressError();
  operationInProgress = true;

  let connection: QCConnection | undefined;
  let session: QCSession | undefined;
  try {
    // Session requests use the QC's outbound HID channel even when the
    // requested operation is read-only. Only the typed transfer layer can
    // construct grid mutations.
    connection = new QCConnection({ allowExperimentalWrites: true });
    session = new QCSession(connection);
    connection.connect();
    await session.start();
    return await operation(session);
  } finally {
    try {
      session?.close();
    } finally {
      try {
        connection?.disconnect();
      } finally {
        operationInProgress = false;
      }
    }
  }
}

/** Opens an exclusive session and performs no grid mutation. */
export async function preflightToneForConnectedQC(
  tone: TonePreset,
  options: QCToneTransferOptions = {},
): Promise<QCToneTransferPreflightResult> {
  return withConnectedQC((session) =>
    preflightToneForCurrentGrid(tone, session, options),
  );
}

/**
 * Opens one exclusive local HID session, applies a verified sparse transaction,
 * and always releases the native handle.
 */
export async function transferToneToConnectedQC(
  tone: TonePreset,
  options: QCToneTransferOptions = {},
): Promise<QCToneTransferResult> {
  return withConnectedQC((session) =>
    applyToneToCurrentGrid(tone, session, options),
  );
}

export function resetQCTransferServiceForTests(): void {
  operationInProgress = false;
}
