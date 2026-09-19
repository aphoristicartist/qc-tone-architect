import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_TONE } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ generateTone: vi.fn() }));

vi.mock("@/lib/tone-generation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tone-generation")>();
  return { ...actual, generateTone: mocks.generateTone };
});

import { GLMConfigurationError } from "@/lib/glm";
import {
  CodexAuthenticationError,
  CodexConfigurationError,
  CodexExecutionError,
} from "@/lib/codex-tone-generation";
import { ToneGenerationError } from "@/lib/tone-generation";
import { toneGenerationRateLimiter } from "@/lib/rate-limit";

import { POST } from "./route";

function request(body: BodyInit) {
  return new Request("http://localhost/api/generate-tone", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body,
  });
}

describe("POST /api/generate-tone", () => {
  beforeEach(() => {
    mocks.generateTone.mockReset().mockResolvedValue(TEST_TONE);
    toneGenerationRateLimiter.reset();
  });

  it("returns a generated tone with no-store caching", async () => {
    const response = await POST(
      request(JSON.stringify({ prompt: "  Focused lead tone  " })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(TEST_TONE);
    expect(mocks.generateTone).toHaveBeenCalledWith(
      "Focused lead tone",
      expect.any(AbortSignal),
      "quad-cortex",
      [],
    );
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await POST(request("{bad json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
  });

  it.each([
    new Request("http://localhost/api/generate-tone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Focused lead tone" }),
    }),
    new Request("http://localhost/api/generate-tone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
      body: JSON.stringify({ prompt: "Focused lead tone" }),
    }),
  ])("rejects cross-origin or originless requests", async (input) => {
    const response = await POST(input);

    expect(response.status).toBe(403);
    expect(mocks.generateTone).not.toHaveBeenCalled();
  });

  it("requires JSON content", async () => {
    const response = await POST(
      new Request("http://localhost/api/generate-tone", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ prompt: "Focused lead tone" }),
      }),
    );

    expect(response.status).toBe(415);
    expect(mocks.generateTone).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies", async () => {
    const response = await POST(
      request(JSON.stringify({ prompt: "x".repeat(128 * 1024) })),
    );

    expect(response.status).toBe(413);
    expect(mocks.generateTone).not.toHaveBeenCalled();
  });

  it("passes the Final Cut Camera generation target", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          prompt: "Modern ambient jazz",
          target: "final-cut-camera",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.generateTone).toHaveBeenCalledWith(
      "Modern ambient jazz",
      expect.any(AbortSignal),
      "final-cut-camera",
      [],
    );
  });

  it("passes explicitly owned plugin licenses", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          prompt: "Modern Rabea lead",
          owned_plugins: ["archetype-rabea-x"],
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.generateTone).toHaveBeenCalledWith(
      "Modern Rabea lead",
      expect.any(AbortSignal),
      "quad-cortex",
      ["archetype-rabea-x"],
    );
  });

  it.each([
    JSON.stringify({ prompt: "" }),
    JSON.stringify({ prompt: " ".repeat(20) }),
    JSON.stringify({ prompt: "x".repeat(1_001) }),
    JSON.stringify({ prompt: "valid", unexpected: true }),
    JSON.stringify({ prompt: "valid", target: "garageband" }),
    JSON.stringify({ prompt: "valid", owned_plugins: ["unknown-plugin"] }),
    JSON.stringify({}),
  ])("returns 400 for invalid input", async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mocks.generateTone).not.toHaveBeenCalled();
  });

  it("returns 503 without exposing configuration details", async () => {
    mocks.generateTone.mockRejectedValue(
      new GLMConfigurationError("secret provider configuration detail"),
    );

    const response = await POST(
      request(JSON.stringify({ prompt: "Focused lead tone" })),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Tone generation is not configured",
    });
  });

  it("returns an actionable 503 when local Codex is not signed in", async () => {
    mocks.generateTone.mockRejectedValue(
      new CodexAuthenticationError("private authentication detail"),
    );

    const response = await POST(
      request(JSON.stringify({ prompt: "Focused lead tone" })),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Codex login is required on this computer",
    });
  });

  it("does not expose Codex configuration details", async () => {
    mocks.generateTone.mockRejectedValue(
      new CodexConfigurationError("private local path"),
    );

    const response = await POST(
      request(JSON.stringify({ prompt: "Focused lead tone" })),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Tone generation is not configured",
    });
  });

  it("returns an actionable 503 for rejected provider credentials", async () => {
    mocks.generateTone.mockRejectedValue({
      status: 401,
      message: "secret upstream response",
    });

    const response = await POST(
      request(JSON.stringify({ prompt: "Focused lead tone" })),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Tone generation credentials were rejected",
    });
  });

  it("returns 502 when provider output is invalid", async () => {
    mocks.generateTone.mockRejectedValue(
      new ToneGenerationError("invalid_tone", "private validation detail"),
    );

    const response = await POST(
      request(JSON.stringify({ prompt: "Focused lead tone" })),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error:
        "The model returned an invalid tone. Please try a more specific prompt.",
    });
  });

  it("returns a sanitized 502 when Codex execution fails", async () => {
    mocks.generateTone.mockRejectedValue(
      new CodexExecutionError("failed", "private diagnostic"),
    );

    const response = await POST(
      request(JSON.stringify({ prompt: "Focused lead tone" })),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Tone generation is temporarily unavailable",
    });
  });

  it("rate limits expensive generation requests", async () => {
    const makeRequest = () =>
      POST(
        new Request("http://localhost/api/generate-tone", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
            "x-forwarded-for": "203.0.113.9",
          },
          body: JSON.stringify({ prompt: "Focused lead tone" }),
        }),
      );

    for (let index = 0; index < 10; index += 1) {
      expect((await makeRequest()).status).toBe(200);
    }
    const response = await makeRequest();

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    await expect(response.json()).resolves.toEqual({
      error: "Too many tone requests. Please wait and try again.",
    });
  });
});
