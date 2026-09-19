/**
 * USB HID Traffic Capture Tool
 *
 * Connects directly to the Quad Cortex and captures raw HID reports
 * to reverse-engineer the exact envelope format.
 *
 * Usage:
 *   pnpm run qc:capture
 *
 * Steps:
 *   1. Make sure Cortex Control is CLOSED
 *   2. Connect QC via USB
 *   3. Run this script
 *   4. It will list HID interfaces and attempt to read raw data
 */

import * as HID from "node-hid";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const QC_VID = 0x152a;
const QC_PID = 0x880a;

const LOG_FILE = join(__dirname, "..", "captures", `capture-${Date.now()}.jsonl`);

function hexDump(buf: Buffer, maxLen = 128): string {
  const hex = buf.subarray(0, maxLen).toString("hex").match(/../g)?.join(" ") || "";
  const ascii = [...buf.subarray(0, maxLen)]
    .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
    .join("");
  return `${hex}\n  ASCII: ${ascii}`;
}

async function main() {
  console.log("=== Quad Cortex USB HID Capture Tool ===\n");

  // List all HID devices
  const allDevices = HID.devices();
  const qcDevices = allDevices.filter(
    (d) => d.vendorId === QC_VID && d.productId === QC_PID
  );

  if (qcDevices.length === 0) {
    console.error("No Quad Cortex found!");
    console.log("\nAll HID devices:");
    for (const d of allDevices.slice(0, 20)) {
      console.log(
        `  VID:${d.vendorId?.toString(16)} PID:${d.productId?.toString(16)} ${d.manufacturer || ""} ${d.product || ""} usage:${d.usage} usagePage:${d.usagePage}`
      );
    }
    process.exit(1);
  }

  console.log(`Found ${qcDevices.length} QC HID interface(s):\n`);
  for (const d of qcDevices) {
    console.log(`  Path: ${d.path}`);
    console.log(`  Product: ${d.product}`);
    console.log(`  Manufacturer: ${d.manufacturer}`);
    console.log(`  Serial: ${d.serialNumber}`);
    console.log(`  Usage Page: 0x${(d.usagePage || 0).toString(16)}`);
    console.log(`  Usage: 0x${(d.usage || 0).toString(16)}`);
    console.log(`  Interface: ${d.interface}`);
    console.log(`  Release: ${d.release}`);
    console.log();
  }

  // Try to open each interface and read data
  for (const devInfo of qcDevices) {
    console.log(`\n--- Trying interface ${devInfo.interface} (usage page 0x${(devInfo.usagePage || 0).toString(16)}) ---`);

    let device: HID.HID;
    try {
      device = new HID.HID(devInfo.path!);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.log(`  Failed to open: ${msg}`);
      continue;
    }

    console.log("  Opened successfully. Listening for data...");
    console.log("  (Press Ctrl+C to stop)\n");

    // Ensure captures directory exists
    const capturesDir = join(__dirname, "..", "captures");
    mkdirSync(capturesDir, { recursive: true });

    let packetCount = 0;

    console.log("  Passive capture only; no data will be written to the QC.");

    device.on("data", (data: Buffer) => {
      packetCount++;
      const timestamp = new Date().toISOString();

      console.log(`\n[${timestamp}] Packet #${packetCount} (${data.length} bytes):`);
      console.log(`  ${hexDump(data)}`);

      // Log to file
      const entry = {
        timestamp,
        interface: devInfo.interface,
        usagePage: devInfo.usagePage,
        length: data.length,
        hex: data.toString("hex"),
      };
      appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
    });

    device.on("error", (err: Error) => {
      console.error(`  Error: ${err.message}`);
    });

    // Keep running
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        console.log(`\n\nCaptured ${packetCount} packets. Saved to ${LOG_FILE}`);
        device.close();
        resolve();
      });
    });

    break; // Only monitor first interface for now
  }
}

main().catch(console.error);
