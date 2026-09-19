import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  construct: vi.fn(),
  devices: vi.fn(),
  on: vi.fn(),
  write: vi.fn(),
}));

vi.mock("node-hid", () => {
  class HID {
    constructor(path: string) {
      mocks.construct(path);
    }

    close = mocks.close;
    on = mocks.on;
    write = mocks.write;
  }

  return { HID, devices: mocks.devices };
});

import {
  discoverDevices,
  QCConnection,
} from "./qc-connection";

const device = {
  vendorId: 0x152a,
  productId: 0x880a,
  path: "private-hid-path",
  manufacturer: "Neural DSP",
  product: "Quad Cortex",
};

describe("Quad Cortex HID connection", () => {
  beforeEach(() => {
    mocks.devices.mockReturnValue([device]);
    mocks.write.mockImplementation((report: number[]) => report.length);
  });

  it("discovers only Quad Cortex interfaces with usable paths", () => {
    mocks.devices.mockReturnValue([
      device,
      { ...device, path: undefined },
      { ...device, path: "" },
      { ...device, productId: 123, path: "other" },
    ]);

    expect(discoverDevices()).toEqual([device]);
  });

  it("keeps all writes disabled by default", () => {
    const connection = new QCConnection();
    connection.connect();

    expect(() => connection.sendRawProtocolMessage(Uint8Array.of(1))).toThrow(
      "Experimental Quad Cortex writes are disabled",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("uses confirmed framing only after an explicit experimental opt-in", () => {
    const connection = new QCConnection({ allowExperimentalWrites: true });
    connection.connect();

    expect(
      connection.sendRawProtocolMessage(new Uint8Array(127).fill(0x5a)),
    ).toBe(2);
    expect(mocks.write).toHaveBeenCalledTimes(2);

    const [firstReport] = mocks.write.mock.calls[0] as [number[]];
    const [lastReport] = mocks.write.mock.calls[1] as [number[]];
    expect(firstReport).toHaveLength(129);
    expect(firstReport.slice(0, 3)).toEqual([0x02, 126, 0x40]);
    expect(lastReport.slice(0, 4)).toEqual([0x02, 1, 0x80, 0x5a]);
  });

  it("sanitizes native open failures", () => {
    mocks.construct.mockImplementationOnce(() => {
      throw new Error("native path and details");
    });
    expect(() => new QCConnection().connect()).toThrow(
      "Unable to open the Quad Cortex HID interface",
    );

  });

  it("continues fragmented writes across the device's expected HID stalls", () => {
    const connection = new QCConnection({ allowExperimentalWrites: true });
    connection.connect();
    mocks.write.mockImplementation(() => {
      throw new Error("IOHIDDeviceSetReport failed");
    });

    expect(connection.sendRawProtocolMessage(new Uint8Array(127))).toBe(2);
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });

  it("forwards raw reports and supports unsubscribe", () => {
    const connection = new QCConnection();
    const handler = vi.fn();
    const unsubscribe = connection.onReport(handler);
    connection.connect();

    const dataRegistration = mocks.on.mock.calls.find(
      ([event]) => event === "data",
    ) as [string, (report: Buffer) => void];
    dataRegistration[1](Buffer.from([1, 2, 3]));
    expect(handler).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));

    unsubscribe();
    dataRegistration[1](Buffer.from([4]));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("isolates report handlers and releases a failed native handle", () => {
    const connection = new QCConnection();
    const firstHandler = vi.fn(() => {
      throw new Error("consumer failure");
    });
    const secondHandler = vi.fn();
    connection.onReport(firstHandler);
    connection.onReport(secondHandler);
    connection.connect();

    const dataRegistration = mocks.on.mock.calls.find(
      ([event]) => event === "data",
    ) as [string, (report: Buffer) => void];
    dataRegistration[1](Buffer.from([1]));
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledOnce();

    const errorRegistration = mocks.on.mock.calls.find(
      ([event]) => event === "error",
    ) as [string, () => void];
    errorRegistration[1]();
    expect(connection.isConnected()).toBe(false);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("notifies isolated disconnect listeners exactly once", () => {
    const connection = new QCConnection();
    const first = vi.fn(() => {
      throw new Error("listener failure");
    });
    const second = vi.fn();
    connection.onDisconnect(first);
    connection.onDisconnect(second);
    connection.connect();

    connection.disconnect();
    connection.disconnect();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith(undefined);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
