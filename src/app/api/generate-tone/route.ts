import {
  CodexAuthenticationError,
  CodexConfigurationError,
  CodexExecutionError,
} from "@/lib/codex-tone-generation";
import {
  hasExactJsonContentType,
  isSameOriginRequest,
  parseLimitedJson,
  RequestBodyTooLargeError,
} from "@/lib/api-request";
import { GLMConfigurationError } from "@/lib/glm";
import { generateToneRequestSchema } from "@/lib/tone-schema";
import { generateTone, ToneGenerationError } from "@/lib/tone-generation";
import { ToneProviderConfigurationError } from "@/lib/tone-provider";
import {
  getClientIdentifier,
  toneGenerationRateLimiter,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 180;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function jsonError(
  error: string,
  status: number,
  headers: Record<string, string> = {},
) {
  return Response.json(
    { error },
    { status, headers: { ...NO_STORE_HEADERS, ...headers } },
  );
}

function upstreamStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Tone generation requires a same-origin local request", 403);
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

  const requestResult = generateToneRequestSchema.safeParse(body);
  if (!requestResult.success) {
    return jsonError("Prompt must be between 1 and 1000 characters", 400);
  }

  const rateLimit = toneGenerationRateLimiter.consume(
    getClientIdentifier(request),
  );
  if (!rateLimit.allowed) {
    return jsonError("Too many tone requests. Please wait and try again.", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  try {
    const tone = await generateTone(
      requestResult.data.prompt,
      request.signal,
      requestResult.data.target,
      requestResult.data.owned_plugins,
    );
    return Response.json(tone, { headers: NO_STORE_HEADERS });
  } catch (error: unknown) {
    if (error instanceof CodexAuthenticationError) {
      console.error("Tone generation Codex authentication error");
      return jsonError("Codex login is required on this computer", 503);
    }

    if (
      error instanceof CodexConfigurationError ||
      error instanceof GLMConfigurationError ||
      error instanceof ToneProviderConfigurationError
    ) {
      console.error("Tone generation configuration error:", error.message);
      return jsonError("Tone generation is not configured", 503);
    }

    if ([401, 403].includes(upstreamStatus(error) ?? 0)) {
      console.error("Tone generation credentials were rejected by the provider");
      return jsonError("Tone generation credentials were rejected", 503);
    }

    if (error instanceof ToneGenerationError) {
      console.error(`Tone generation ${error.code}:`, error.message);
      return jsonError(
        "The model returned an invalid tone. Please try a more specific prompt.",
        502,
      );
    }

    if (error instanceof CodexExecutionError) {
      console.error(`Tone generation Codex ${error.code}:`, error.message);
      return jsonError("Tone generation is temporarily unavailable", 502);
    }

    console.error(
      "Tone generation upstream error:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return jsonError("Tone generation is temporarily unavailable", 502);
  }
}
