import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ discoverDevices: vi.fn() }));

vi.mock("@/lib/qc-protocol/qc-connection", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/qc-protocol/qc-connection")
  >();
  return { ...actual, discoverDevices: mocks.discoverDevices };
});

import { QCHIDAccessError } from "@/lib/qc-protocol/qc-connection";

import { GET } from "./route";

describe("GET /api/qc-device", () => {
  beforeEach(() => {
    mocks.discoverDevices.mockReset().mockReturnValue([]);
  });

  it("reports a connected device without leaking its native path", async () => {
    mocks.discoverDevices.mockReturnValue([
      {
        vendorId: 0x152a,
        productId: 0x880a,
        path: "private/native/device/path",
        manufacturer: "Neural DSP",
        product: "Quad Cortex",
        serialNumber: "QC-TEST",
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      connected: true,
      devices: [{ serialNumber: "QC-TEST" }],
      capabilities: { discovery: true, presetTransfer: true },
    });
    expect(JSON.stringify(body)).not.toContain("private/native/device/path");
  });

  it("distinguishes an offline device from a discovery failure", async () => {
    const offlineResponse = await GET();
    expect(offlineResponse.status).toBe(200);
    await expect(offlineResponse.json()).resolves.toMatchObject({
      connected: false,
      capabilities: { discovery: true },
    });

    mocks.discoverDevices.mockImplementation(() => {
      throw new QCHIDAccessError("private native error");
    });
    const failedResponse = await GET();
    expect(failedResponse.status).toBe(503);
    await expect(failedResponse.json()).resolves.toMatchObject({
      connected: false,
      capabilities: { discovery: false },
      error: expect.stringContaining("USB device access failed"),
    });
  });
});
