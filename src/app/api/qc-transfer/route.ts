import { z } from "zod";

import {
  hasExactJsonContentType,
  isSameOriginRequest,
  parseLimitedJson,
  RequestBodyTooLargeError,
} from "@/lib/api-request";
import { QCHIDAccessError } from "@/lib/qc-protocol/qc-connection";
import {
  QCFirmwareCompatibilityError,
  QCSessionTimeoutError,
} from "@/lib/qc-protocol/session";
import {
  QCToneTransferError,
  QCToneTransferPreflightError,
  QCToneTransferRollbackError,
} from "@/lib/qc-protocol/tone-transfer";
import { FixedWindowRateLimiter, getClientIdentifier } from "@/lib/rate-limit";
import { tonePresetSchema } from "@/lib/tone-schema";
import {
  QCOperationInProgressError,
  transferToneToConnectedQC,
} from "@/lib/qc-transfer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONFIRMATION = "APPLY_TO_EMPTY_PRESET";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const transferRateLimiter = new FixedWindowRateLimiter(5, 60_000);
const transferRequestSchema = z
  .object({
    tone: tonePresetSchema,
    confirmation: z.literal(CONFIRMATION),
  })
  .strict();

let transferInProgress = false;

function jsonError(error: string, status: number, retryAfter?: number) {
  return Response.json(
    { error },
    {
      status,
      headers: {
        ...NO_STORE_HEADERS,
        ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
      },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Tone transfer requires a same-origin local request", 403);
  }
  if (!hasExactJsonContentType(request)) {
    return jsonError("Content-Type must be application/json", 415);
  }

  let body: unknown;
  try {
    body = await parseLimitedJson(request);
  } catch (error) {
    return jsonError(
      error instanceof RequestBodyTooLargeError
        ? "Request body is too large"
        : "Request body must be valid JSON",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }
  const parsed = transferRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "A valid tone and explicit empty-preset confirmation are required",
      400,
    );
  }

  const rateLimit = transferRateLimiter.consume(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return jsonError(
      "Too many transfer attempts. Wait before trying again.",
      429,
      rateLimit.retryAfterSeconds,
    );
  }
  if (transferInProgress) {
    return jsonError("Another Quad Cortex transfer is already running", 409);
  }

  transferInProgress = true;
  try {
    const result = await transferToneToConnectedQC(parsed.data.tone, {
      signal: request.signal,
    });
    return Response.json(
      { ok: true, ...result },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof QCToneTransferRollbackError) {
      console.error("Critical Quad Cortex rollback verification failure");
      return jsonError(
        "Transfer failed and automatic rollback could not be verified. Inspect the preset on the Quad Cortex before continuing.",
        500,
      );
    }
    if (error instanceof QCToneTransferPreflightError) {
      return jsonError(error.message, 422);
    }
    if (error instanceof QCOperationInProgressError) {
      return jsonError("Another Quad Cortex operation is already running", 409);
    }
    if (error instanceof QCFirmwareCompatibilityError) {
      return jsonError(
        "This Quad Cortex firmware has not been verified for direct transfer",
        409,
      );
    }
    if (error instanceof QCHIDAccessError) {
      return jsonError(
        "Unable to open the Quad Cortex. Connect it locally, close Cortex Control, and check USB permissions.",
        503,
      );
    }
    if (error instanceof QCSessionTimeoutError) {
      return jsonError(
        "The Quad Cortex stopped responding. The transaction was not reported as successful.",
        504,
      );
    }
    if (error instanceof QCToneTransferError) {
      return jsonError(
        "The Quad Cortex rejected the tone transaction. Any applied blocks were rolled back.",
        502,
      );
    }
    console.error(
      "Unexpected Quad Cortex transfer error:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return jsonError("Quad Cortex transfer failed safely", 500);
  } finally {
    transferInProgress = false;
  }
}

export function resetQCTransferRouteForTests(): void {
  transferInProgress = false;
  transferRateLimiter.reset();
}
