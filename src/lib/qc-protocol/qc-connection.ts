/**
 * Quad Cortex USB HID discovery and experimental raw transport.
 *
 * Device discovery and low-level transport. Typed session and transactional
 * preset operations are implemented in separate, firmware-gated modules.
 */

import * as HID from "node-hid";

import { encodeHIDReports } from "./hid-framing";

const QC_VENDOR_ID = 0x152a;
const QC_PRODUCT_ID = 0x880a;

export interface QCDeviceInfo {
  vendorId: number;
  productId: number;
  path: string;
  serialNumber?: string;
  manufacturer?: string;
  product?: string;
}

export class QCHIDAccessError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QCHIDAccessError";
  }
}

/** Discovers Quad Cortex HID interfaces connected to the local computer. */
export function discoverDevices(): QCDeviceInfo[] {
  try {
    return HID.devices()
      .filter(
        (device) =>
          device.vendorId === QC_VENDOR_ID &&
          device.productId === QC_PRODUCT_ID &&
          typeof device.path === "string" &&
          device.path.length > 0,
      )
      .map((device) => ({
        vendorId: device.vendorId,
        productId: device.productId,
        path: device.path!,
        serialNumber: device.serialNumber,
        manufacturer: device.manufacturer,
        product: device.product,
      }));
  } catch (error) {
    throw new QCHIDAccessError(
      "Unable to enumerate USB HID devices. Check local USB permissions.",
      { cause: error },
    );
  }
}

type ReportHandler = (report: Buffer) => void;
type DisconnectHandler = (error?: QCHIDAccessError) => void;

export interface QCConnectionOptions {
  /**
   * Raw writes require an explicit opt-in. Application code must still use the
   * typed, firmware-gated session and transactional transfer service.
   */
  allowExperimentalWrites?: boolean;
}

/**
 * Owns a local QC HID handle and exposes raw reports to the typed session.
 */
export class QCConnection {
  private device: HID.HID | null = null;
  private connected = false;
  private readonly reportHandlers = new Set<ReportHandler>();
  private readonly disconnectHandlers = new Set<DisconnectHandler>();
  private readonly allowExperimentalWrites: boolean;

  constructor(options: QCConnectionOptions = {}) {
    this.allowExperimentalWrites = options.allowExperimentalWrites ?? false;
  }

  connect(devicePath?: string): void {
    if (this.connected) {
      throw new QCHIDAccessError("A Quad Cortex HID connection is already open.");
    }

    const devices = discoverDevices();
    if (devices.length === 0) {
      throw new QCHIDAccessError(
        "No Quad Cortex found. Connect it to this computer via USB.",
      );
    }

    const target = devicePath
      ? devices.find((device) => device.path === devicePath)
      : devices[0];
    if (!target) {
      throw new QCHIDAccessError(
        "The requested Quad Cortex HID interface was not found.",
      );
    }

    try {
      const device = new HID.HID(target.path);
      this.device = device;
      this.connected = true;

      device.on("data", (report: Buffer) => {
        for (const handler of this.reportHandlers) {
          try {
            handler(Buffer.from(report));
          } catch {
            // A consumer must not break report delivery to other subscribers.
          }
        }
      });
      device.on("error", () => {
        if (this.device !== device) return;
        this.device = null;
        this.connected = false;
        try {
          device.close();
        } catch {
          // The native handle may already be closed after a device error.
        }
        this.notifyDisconnected(
          new QCHIDAccessError("The Quad Cortex USB connection was lost."),
        );
      });
    } catch (error) {
      this.device = null;
      this.connected = false;
      throw new QCHIDAccessError(
        "Unable to open the Quad Cortex HID interface. Close Cortex Control and check USB permissions.",
        { cause: error },
      );
    }
  }

  disconnect(): void {
    const device = this.device;
    const wasConnected = this.connected;
    this.device = null;
    this.connected = false;
    try {
      device?.close();
    } catch {
      // Disconnect remains idempotent even if the native handle already died.
    }
    if (wasConnected) this.notifyDisconnected();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Subscribes to unparsed reports exactly as returned by node-hid. */
  onReport(handler: ReportHandler): () => void {
    this.reportHandlers.add(handler);
    return () => this.reportHandlers.delete(handler);
  }

  /** Subscribes to native disconnects and intentional handle closure. */
  onDisconnect(handler: DisconnectHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  /**
   * Sends one already-serialized protocol message using confirmed outbound HID
   * framing. The typed session remains responsible for message validation.
   */
  sendRawProtocolMessage(message: Uint8Array): number {
    if (!this.allowExperimentalWrites) {
      throw new QCHIDAccessError(
        "Experimental Quad Cortex writes are disabled. Typed messages and firmware compatibility are not verified.",
      );
    }
    if (!this.device || !this.connected) {
      throw new QCHIDAccessError("No Quad Cortex HID connection is open.");
    }

    const reports = encodeHIDReports(message);
    for (const report of reports) {
      try {
        this.device.write([...report]);
      } catch {
        // CorOS 4.0.1 consumes every SET_REPORT and then deliberately stalls
        // the status stage. All known host HID stacks surface that as a write
        // error, including Cortex Control's own IOKit transport. Completion
        // must be established from a matching device response or timeout.
      }
    }

    return reports.length;
  }

  private notifyDisconnected(error?: QCHIDAccessError): void {
    for (const handler of this.disconnectHandlers) {
      try {
        handler(error);
      } catch {
        // Teardown of one consumer must not prevent other consumers running.
      }
    }
  }
}
