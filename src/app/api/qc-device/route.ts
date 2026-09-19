import {
  discoverDevices,
  QCHIDAccessError,
} from "@/lib/qc-protocol/qc-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const devices = discoverDevices();
    return Response.json(
      {
        connected: devices.length > 0,
        devices: devices.map((device) => ({
          vendorId: `0x${device.vendorId.toString(16)}`,
          productId: `0x${device.productId.toString(16)}`,
          manufacturer: device.manufacturer ?? "Neural DSP",
          product: device.product ?? "Quad Cortex",
          serialNumber: device.serialNumber,
        })),
        capabilities: {
          discovery: true,
          presetTransfer: devices.length > 0,
          reason:
            devices.length > 0
              ? "Transfer requires a supported firmware and empty target grid cells."
              : "Connect a Quad Cortex locally to transfer a tone.",
        },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error(
      "Quad Cortex discovery error:",
      error instanceof Error ? error.name : "UnknownError",
    );
    const message =
      error instanceof QCHIDAccessError
        ? "USB device access failed. Check that this app is running locally and has USB permission."
        : "Quad Cortex discovery failed.";
    return Response.json(
      {
        connected: false,
        devices: [],
        capabilities: { discovery: false, presetTransfer: false },
        error: message,
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
