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
} from "@/lib/qc-protocol/tone-transfer";
import { FixedWindowRateLimiter, getClientIdentifier } from "@/lib/rate-limit";
import { tonePresetSchema } from "@/lib/tone-schema";
import {
  preflightToneForConnectedQC,
  QCOperationInProgressError,
} from "@/lib/qc-transfer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const preflightRateLimiter = new FixedWindowRateLimiter(12, 60_000);
const preflightRequestSchema = z.object({ tone: tonePresetSchema }).strict();

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
    return jsonError("Tone preflight requires a same-origin local request", 403);
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
  const parsed = preflightRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("A valid tone is required for transfer preflight", 400);
  }

  const rateLimit = preflightRateLimiter.consume(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return jsonError(
      "Too many preflight attempts. Wait before trying again.",
      429,
      rateLimit.retryAfterSeconds,
    );
  }

  try {
    const result = await preflightToneForConnectedQC(parsed.data.tone, {
      signal: request.signal,
    });
    return Response.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof QCToneTransferPreflightError) {
      return jsonError(error.message, 422);
    }
    if (error instanceof QCFirmwareCompatibilityError) {
      return jsonError(
        "This Quad Cortex firmware has not been verified for direct transfer",
        409,
      );
    }
    if (error instanceof QCOperationInProgressError) {
      return jsonError("Another Quad Cortex operation is already running", 409);
    }
    if (error instanceof QCHIDAccessError) {
      return jsonError(
        "Unable to open the Quad Cortex. Connect it locally, close Cortex Control, and check USB permissions.",
        503,
      );
    }
    if (error instanceof QCSessionTimeoutError) {
      return jsonError("The Quad Cortex stopped responding during preflight", 504);
    }
    if (error instanceof QCToneTransferError) {
      return jsonError("The Quad Cortex could not validate this tone", 502);
    }
    console.error(
      "Unexpected Quad Cortex preflight error:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return jsonError("Quad Cortex preflight failed safely", 500);
  }
}

export function resetQCPreflightRouteForTests(): void {
  preflightRateLimiter.reset();
}
