"use client";

import { useState, useEffect } from "react";
import { Usb, Circle } from "lucide-react";

interface QCDevice {
  vendorId: string;
  productId: string;
  manufacturer: string;
  product: string;
  serialNumber?: string;
}

interface QCDeviceResponse {
  connected: boolean;
  devices: QCDevice[];
  error?: string;
}

export default function QCStatus() {
  const [connected, setConnected] = useState(false);
  const [device, setDevice] = useState<QCDevice | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function check() {
      controller = new AbortController();
      try {
        const res = await fetch("/api/qc-device", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json()) as QCDeviceResponse;
        if (!res.ok) {
          throw new Error(data.error || "Device check failed");
        }
        setConnected(data.connected);
        setDevice(data.devices?.[0] || null);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setConnected(false);
        setDevice(null);
        setError(
          cause instanceof Error ? cause.message : "Device check failed",
        );
      } finally {
        if (!stopped) {
          setChecking(false);
          timer = setTimeout(check, 5_000);
        }
      }
    }

    check();
    return () => {
      stopped = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (checking) {
    return (
      <div
        className="flex items-center gap-1.5 text-[10px] text-zinc-400"
        role="status"
        aria-live="polite"
      >
        <Usb className="w-3 h-3 animate-pulse" />
        <span>Checking...</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 text-[10px] group relative"
      role="status"
      aria-live="polite"
      tabIndex={0}
    >
      <Circle
        className={`w-2 h-2 ${
          connected
            ? "fill-emerald-500 text-emerald-500"
            : "fill-zinc-600 text-zinc-600"
        }`}
      />
      <Usb className={`w-3 h-3 ${connected ? "text-zinc-400" : "text-zinc-600"}`} />
      <span className="text-zinc-400">
        {connected ? "QC Connected" : "QC Offline"}
      </span>

      {/* Tooltip */}
      {(device || error) && (
        <div className="absolute top-full right-0 mt-2 p-3 rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
          {device ? (
            <>
              <div className="text-xs text-zinc-300 font-medium">{device.product}</div>
              <div className="text-[10px] text-zinc-400 mt-1">
                Serial: {device.serialNumber || "N/A"}
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5">
                USB {device.vendorId}:{device.productId}
              </div>
            </>
          ) : (
            <div className="max-w-72 whitespace-normal text-[10px] text-red-400">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
