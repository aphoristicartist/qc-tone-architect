import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_TONE } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ transferToneToConnectedQC: vi.fn() }));

vi.mock("@/lib/qc-transfer-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/qc-transfer-service")
  >();
  return {
    ...actual,
    transferToneToConnectedQC: mocks.transferToneToConnectedQC,
  };
});

import { QCHIDAccessError } from "@/lib/qc-protocol/qc-connection";
import { QCFirmwareCompatibilityError } from "@/lib/qc-protocol/session";
import {
  QCToneTransferPreflightError,
  QCToneTransferRollbackError,
} from "@/lib/qc-protocol/tone-transfer";
import { QCOperationInProgressError } from "@/lib/qc-transfer-service";

import { POST, resetQCTransferRouteForTests } from "./route";

function request(
  body: BodyInit,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/qc-transfer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      ...headers,
    },
    body,
  });
}

function validBody() {
  return JSON.stringify({
    tone: TEST_TONE,
    confirmation: "APPLY_TO_EMPTY_PRESET",
  });
}

describe("POST /api/qc-transfer", () => {
  beforeEach(() => {
    resetQCTransferRouteForTests();
    mocks.transferToneToConnectedQC.mockReset().mockResolvedValue({
      appliedBlocks: 4,
      appliedParameters: 11,
      configuredScenes: 2,
      firmware: "4.0.1/d14e",
    });
  });

  it("applies a validated explicitly confirmed tone with no-store caching", async () => {
    const response = await POST(request(validBody()));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      appliedBlocks: 4,
      appliedParameters: 11,
      configuredScenes: 2,
      firmware: "4.0.1/d14e",
    });
    expect(mocks.transferToneToConnectedQC).toHaveBeenCalledWith(TEST_TONE, {
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    request(validBody(), { Origin: "https://attacker.example" }),
    new Request("http://localhost/api/qc-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody(),
    }),
  ])("rejects cross-origin or originless write requests", async (input) => {
    const response = await POST(input);

    expect(response.status).toBe(403);
    expect(mocks.transferToneToConnectedQC).not.toHaveBeenCalled();
  });

  it.each([
    ["{bad json", 400],
    [JSON.stringify({ tone: TEST_TONE, confirmation: "yes" }), 400],
    [JSON.stringify({ confirmation: "APPLY_TO_EMPTY_PRESET" }), 400],
    ["x".repeat(128 * 1024 + 1), 413],
  ])("rejects malformed, unconfirmed, or oversized input", async (body, status) => {
    const response = await POST(request(body));

    expect(response.status).toBe(status);
    expect(mocks.transferToneToConnectedQC).not.toHaveBeenCalled();
  });

  it("requires the exact JSON media type", async () => {
    const response = await POST(
      request(validBody(), { "Content-Type": "application/json-patch+json" }),
    );

    expect(response.status).toBe(415);
    expect(mocks.transferToneToConnectedQC).not.toHaveBeenCalled();
  });

  it("rate limits repeated physical transfer attempts", async () => {
    for (let index = 0; index < 5; index += 1) {
      expect((await POST(request(validBody()))).status).toBe(200);
    }

    const response = await POST(request(validBody()));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("serializes access to the exclusive HID connection", async () => {
    let resolveFirst!: (value: {
      appliedBlocks: number;
      appliedParameters: number;
      configuredScenes: number;
      firmware: string;
    }) => void;
    mocks.transferToneToConnectedQC.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const first = POST(request(validBody()));
    await vi.waitFor(() =>
      expect(mocks.transferToneToConnectedQC).toHaveBeenCalledTimes(1),
    );
    const second = await POST(request(validBody()));

    expect(second.status).toBe(409);
    resolveFirst({
      appliedBlocks: 4,
      appliedParameters: 11,
      configuredScenes: 2,
      firmware: "4.0.1/d14e",
    });
    expect((await first).status).toBe(200);
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
      new QCHIDAccessError("private native path"),
      503,
      "close Cortex Control",
    ],
    [
      new QCOperationInProgressError(),
      409,
      "Another Quad Cortex operation",
    ],
    [
      new QCToneTransferRollbackError(
        new Error("apply"),
        new Error("rollback"),
      ),
      500,
      "rollback could not be verified",
    ],
  ])("maps hardware failures without leaking private details", async (error, status, message) => {
    mocks.transferToneToConnectedQC.mockRejectedValue(error);

    const response = await POST(request(validBody()));
    const result = await response.json();

    expect(response.status).toBe(status);
    expect(result.error).toContain(message);
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
