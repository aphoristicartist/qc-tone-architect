import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_TONE } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({
  applyToneToCurrentGrid: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
  connectionConstructor: vi.fn(),
  disconnect: vi.fn(),
  preflightToneForCurrentGrid: vi.fn(),
  sessionConstructor: vi.fn(),
  start: vi.fn(),
}));

vi.mock("./qc-protocol/qc-connection", () => ({
  QCConnection: class {
    constructor(options: unknown) {
      mocks.connectionConstructor(options, this);
    }

    connect = mocks.connect;
    disconnect = mocks.disconnect;
  },
}));

vi.mock("./qc-protocol/session", () => ({
  QCSession: class {
    constructor(connection: unknown) {
      mocks.sessionConstructor(connection, this);
    }

    start = mocks.start;
    close = mocks.close;
  },
}));

vi.mock("./qc-protocol/tone-transfer", () => ({
  applyToneToCurrentGrid: mocks.applyToneToCurrentGrid,
  preflightToneForCurrentGrid: mocks.preflightToneForCurrentGrid,
}));

import {
  preflightToneForConnectedQC,
  QCOperationInProgressError,
  resetQCTransferServiceForTests,
  transferToneToConnectedQC,
} from "./qc-transfer-service";

describe("Quad Cortex transfer service", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    resetQCTransferServiceForTests();
    mocks.start.mockResolvedValue({});
    mocks.preflightToneForCurrentGrid.mockResolvedValue({
      ready: true,
      firmware: "4.0.1/d14e",
      targetCells: ["1.1", "1.2", "1.3", "1.4"],
      requiredBlocks: 4,
      configuredScenes: 2,
    });
    mocks.applyToneToCurrentGrid.mockResolvedValue({
      appliedBlocks: 4,
      appliedParameters: 11,
      configuredScenes: 2,
      firmware: "4.0.1/d14e",
    });
  });

  it("opens an explicitly writable typed session and returns verified results", async () => {
    await expect(transferToneToConnectedQC(TEST_TONE)).resolves.toMatchObject({
      appliedBlocks: 4,
      firmware: "4.0.1/d14e",
    });

    expect(mocks.connectionConstructor).toHaveBeenCalledWith({
      allowExperimentalWrites: true,
    }, expect.anything());
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.applyToneToCurrentGrid).toHaveBeenCalledWith(
      TEST_TONE,
      expect.anything(),
      {},
    );
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it("always releases both session and native HID handle after failure", async () => {
    mocks.applyToneToCurrentGrid.mockRejectedValue(new Error("apply failed"));

    await expect(transferToneToConnectedQC(TEST_TONE)).rejects.toThrow(
      "apply failed",
    );
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it("performs read-only preflight in an exclusive typed session", async () => {
    await expect(preflightToneForConnectedQC(TEST_TONE)).resolves.toMatchObject({
      ready: true,
      targetCells: ["1.1", "1.2", "1.3", "1.4"],
    });

    expect(mocks.preflightToneForCurrentGrid).toHaveBeenCalledWith(
      TEST_TONE,
      expect.anything(),
      {},
    );
    expect(mocks.applyToneToCurrentGrid).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it("refuses concurrent access to the exclusive HID device", async () => {
    let finishTransfer!: (value: {
      appliedBlocks: number;
      appliedParameters: number;
      configuredScenes: number;
      firmware: string;
    }) => void;
    mocks.applyToneToCurrentGrid.mockReturnValueOnce(
      new Promise((resolve) => {
        finishTransfer = resolve;
      }),
    );

    const transfer = transferToneToConnectedQC(TEST_TONE);
    await vi.waitFor(() =>
      expect(mocks.applyToneToCurrentGrid).toHaveBeenCalledOnce(),
    );
    await expect(preflightToneForConnectedQC(TEST_TONE)).rejects.toThrow(
      QCOperationInProgressError,
    );

    finishTransfer({
      appliedBlocks: 4,
      appliedParameters: 11,
      configuredScenes: 2,
      firmware: "4.0.1/d14e",
    });
    await expect(transfer).resolves.toMatchObject({ appliedBlocks: 4 });
    expect(mocks.connectionConstructor).toHaveBeenCalledOnce();
  });
});
