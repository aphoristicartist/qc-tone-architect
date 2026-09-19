import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_TONE } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ preflightToneForConnectedQC: vi.fn() }));

vi.mock("@/lib/qc-transfer-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/qc-transfer-service")
  >();
  return {
    ...actual,
    preflightToneForConnectedQC: mocks.preflightToneForConnectedQC,
  };
});

import { QCHIDAccessError } from "@/lib/qc-protocol/qc-connection";
import { QCFirmwareCompatibilityError } from "@/lib/qc-protocol/session";
import { QCToneTransferPreflightError } from "@/lib/qc-protocol/tone-transfer";
import { QCOperationInProgressError } from "@/lib/qc-transfer-service";

import { POST, resetQCPreflightRouteForTests } from "./route";

function request(
  body: BodyInit,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/qc-transfer/preflight", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      ...headers,
    },
    body,
  });
}

const validBody = () => JSON.stringify({ tone: TEST_TONE });

describe("POST /api/qc-transfer/preflight", () => {
  beforeEach(() => {
    resetQCPreflightRouteForTests();
    mocks.preflightToneForConnectedQC.mockReset().mockResolvedValue({
      ready: true,
      firmware: "4.0.1/d14e",
      targetCells: ["1.1", "1.2", "1.3", "1.4"],
      requiredBlocks: 4,
      configuredScenes: 2,
    });
  });

  it("returns verified read-only readiness with no-store caching", async () => {
    const response = await POST(request(validBody()));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ready: true,
      firmware: "4.0.1/d14e",
      targetCells: ["1.1", "1.2", "1.3", "1.4"],
      requiredBlocks: 4,
      configuredScenes: 2,
    });
    expect(mocks.preflightToneForConnectedQC).toHaveBeenCalledWith(TEST_TONE, {
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    request(validBody(), { Origin: "https://attacker.example" }),
    new Request("http://localhost/api/qc-transfer/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody(),
    }),
  ])("rejects cross-origin or originless requests", async (input) => {
    expect((await POST(input)).status).toBe(403);
    expect(mocks.preflightToneForConnectedQC).not.toHaveBeenCalled();
  });

  it.each([
    ["{bad json", 400],
    [JSON.stringify({}), 400],
    [JSON.stringify({ tone: TEST_TONE, extra: true }), 400],
    ["x".repeat(128 * 1024 + 1), 413],
  ])("rejects malformed or oversized input", async (body, status) => {
    expect((await POST(request(body))).status).toBe(status);
    expect(mocks.preflightToneForConnectedQC).not.toHaveBeenCalled();
  });

  it("requires the exact JSON media type", async () => {
    const response = await POST(
      request(validBody(), { "Content-Type": "application/json-patch+json" }),
    );

    expect(response.status).toBe(415);
    expect(mocks.preflightToneForConnectedQC).not.toHaveBeenCalled();
  });

  it("rate limits repeated hardware preflight attempts", async () => {
    for (let index = 0; index < 12; index += 1) {
      expect((await POST(request(validBody()))).status).toBe(200);
    }
    const response = await POST(request(validBody()));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it.each([
    [
      new QCToneTransferPreflightError("Target cells are occupied (1.2)"),
      422,
      "Target cells are occupied",
    ],
    [
      new QCFirmwareCompatibilityError("private firmware detail"),
      409,
      "firmware has not been verified",
    ],
    [
      new QCOperationInProgressError(),
      409,
      "Another Quad Cortex operation",
    ],
    [
      new QCHIDAccessError("private native path"),
      503,
      "close Cortex Control",
    ],
  ])("maps hardware failures without leaking private details", async (error, status, message) => {
    mocks.preflightToneForConnectedQC.mockRejectedValue(error);

    const response = await POST(request(validBody()));
    const result = await response.json();

    expect(response.status).toBe(status);
    expect(result.error).toContain(message);
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
