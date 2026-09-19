"use client";

import { useEffect, useState } from "react";
import { type TonePreset } from "@/lib/types";
import { assessCameraReadiness } from "@/lib/camera-readiness";
import SignalChain from "./signal-chain";
import {
  Download,
  Pencil,
  Lightbulb,
  Tag,
  Layers,
  Sparkles,
  Usb,
  Loader2,
  CircleCheck,
  TriangleAlert,
  Smartphone,
} from "lucide-react";

interface QCDeviceResponse {
  connected: boolean;
  capabilities?: { presetTransfer?: boolean };
}

interface QCTransferResponse {
  ok?: boolean;
  error?: string;
  appliedBlocks?: number;
  configuredScenes?: number;
}

interface QCTransferPreflightResponse {
  ready?: boolean;
  error?: string;
  firmware?: string;
  targetCells?: string[];
  requiredBlocks?: number;
  configuredScenes?: number;
}

function formatSceneChange(
  change: TonePreset["scenes"][number]["changes"][number],
): string {
  const updates = Object.entries(change.parameters).map(
    ([name, value]) => `${name}: ${String(value)}`,
  );
  return `Block ${change.row}.${change.position} — ${updates.join(", ")}`;
}

function downloadTone(tone: TonePreset): void {
  const fileName =
    tone.tone_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "qc-tone";
  const blob = new Blob([JSON.stringify(tone, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileName}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface ToneResultProps {
  tone: TonePreset;
  onChange?: (tone: TonePreset) => void;
}

export default function ToneResult({ tone, onChange }: ToneResultProps) {
  const [editing, setEditing] = useState(false);
  const [transferAvailable, setTransferAvailable] = useState(false);
  const [checkingDevice, setCheckingDevice] = useState(true);
  const [transferPhase, setTransferPhase] = useState<
    "preflight" | "transfer" | null
  >(null);
  const [transferNotice, setTransferNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const cameraReport =
    tone.recording_target === "final-cut-camera"
      ? assessCameraReadiness(tone)
      : null;

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function checkTransferAvailability() {
      controller = new AbortController();
      try {
        const response = await fetch("/api/qc-device", {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = (await response.json()) as QCDeviceResponse;
        setTransferAvailable(
          response.ok &&
            result.connected &&
            result.capabilities?.presetTransfer === true,
        );
      } catch {
        if (!controller.signal.aborted) setTransferAvailable(false);
      } finally {
        if (!stopped) {
          setCheckingDevice(false);
          timer = setTimeout(checkTransferAvailability, 5_000);
        }
      }
    }
    void checkTransferAvailability();
    return () => {
      stopped = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  async function transferTone() {
    if (transferPhase || !transferAvailable) return;

    setTransferPhase("preflight");
    setTransferNotice(null);
    try {
      const preflightResponse = await fetch("/api/qc-transfer/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone }),
      });
      const preflight = (await preflightResponse
        .json()
        .catch(() => ({}))) as QCTransferPreflightResponse;
      if (!preflightResponse.ok || preflight.ready !== true) {
        throw new Error(
          preflight.error || `Transfer preflight failed (${preflightResponse.status})`,
        );
      }

      const targetCells =
        preflight.targetCells?.join(", ") || "the verified target cells";
      const confirmed = window.confirm(
        `Read-only preflight passed for QC firmware ${preflight.firmware ?? "unknown"}. Apply this tone to ${targetCells}?\n\nSave any work first and keep Cortex Control closed. Do not unplug the device during transfer. The app repeats preflight, verifies every write, and rolls back inserted blocks if the transaction fails.`,
      );
      if (!confirmed) return;

      setTransferPhase("transfer");
      const response = await fetch("/api/qc-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tone,
          confirmation: "APPLY_TO_EMPTY_PRESET",
        }),
      });
      const result = (await response.json().catch(() => ({}))) as QCTransferResponse;
      if (!response.ok || !result.ok) {
        throw new Error(result.error || `Transfer failed (${response.status})`);
      }
      setTransferNotice({
        kind: "success",
        message: `Transferred and verified ${result.appliedBlocks ?? tone.signal_chain.length} blocks and ${result.configuredScenes ?? tone.scenes.length} scenes. Save the preset on the QC to keep it.`,
      });
    } catch (error) {
      setTransferNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Quad Cortex transfer failed",
      });
    } finally {
      setTransferPhase(null);
    }
  }

  function updateBlock(
    blockIndex: number,
    update: Partial<TonePreset["signal_chain"][number]>,
  ) {
    if (!onChange) return;
    setTransferNotice(null);
    onChange({
      ...tone,
      signal_chain: tone.signal_chain.map((block, index) =>
        index === blockIndex ? { ...block, ...update } : block,
      ),
    });
  }

  function updateParameter(
    blockIndex: number,
    name: string,
    value: string | number | boolean,
  ) {
    const block = tone.signal_chain[blockIndex];
    updateBlock(blockIndex, {
      parameters: { ...block.parameters, [name]: value },
    });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-white">{tone.tone_name}</h2>
          <div className="flex gap-1.5 flex-wrap">
            {tone.genre_tags?.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50"
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {onChange && (
              <button
                type="button"
                aria-pressed={editing}
                onClick={() => setEditing((current) => !current)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                {editing ? "Done editing" : "Edit parameters"}
              </button>
            )}
            <button
              type="button"
              onClick={() => downloadTone(tone)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export JSON
            </button>
          </div>
        </div>
        <p className="text-sm text-zinc-400 leading-relaxed">
          {tone.description}
        </p>
        {tone.inspiration && (
          <p className="text-xs text-zinc-400 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            Inspired by: {tone.inspiration}
          </p>
        )}
      </div>

      {/* Signal Chain Grid */}
      <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800 p-5">
        <SignalChain blocks={tone.signal_chain} />
      </div>

      {cameraReport && (
        <section
          aria-labelledby="camera-readiness-heading"
          className="space-y-4 rounded-2xl border border-emerald-900/60 bg-emerald-950/15 p-5"
        >
          <div className="flex items-start gap-3">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-emerald-400" />
            <div>
              <h3
                id="camera-readiness-heading"
                className="text-sm font-semibold text-emerald-100"
              >
                {cameraReport.ready
                  ? "Ready for Final Cut Camera"
                  : "Final Cut Camera review needed"}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                This check covers the preset structure. Confirm the physical USB
                routing and the loudest-scene meter before every take.
              </p>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {cameraReport.checks.map((check) => (
              <div
                key={check.id}
                className="flex items-start gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3"
              >
                {check.status === "pass" ? (
                  <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                )}
                <div>
                  <p className="text-xs font-medium text-zinc-200">
                    {check.label}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    {check.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <ol className="grid gap-2 text-xs text-zinc-300 md:grid-cols-2">
            <li className="rounded-lg bg-zinc-950/40 p-3">
              <span className="font-medium text-emerald-300">1. QC USB</span>
              <span className="mt-1 block text-zinc-400">
                Set USB dry/wet routing so processed stereo reaches USB 1/2.
              </span>
            </li>
            <li className="rounded-lg bg-zinc-950/40 p-3">
              <span className="font-medium text-emerald-300">2. Final Cut Camera</span>
              <span className="mt-1 block text-zinc-400">
                Settings → Audio → Source → Quad Cortex, then choose Stereo.
              </span>
            </li>
            <li className="rounded-lg bg-zinc-950/40 p-3">
              <span className="font-medium text-emerald-300">3. Monitor</span>
              <span className="mt-1 block text-zinc-400">
                Use the QC headphone output, not AirPods, while recording.
              </span>
            </li>
            <li className="rounded-lg bg-zinc-950/40 p-3">
              <span className="font-medium text-emerald-300">4. Meter</span>
              <span className="mt-1 block text-zinc-400">
                Test the loudest scene at about -12 to -6 dBFS with no clipping.
              </span>
            </li>
          </ol>
        </section>
      )}

      {editing && (
        <section
          aria-label="Tone parameter editor"
          className="rounded-2xl bg-zinc-900/50 border border-zinc-800 p-5 space-y-4"
        >
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">
              Edit block settings
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              Changes are validated, saved locally, and included in JSON export.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tone.signal_chain.map((block, blockIndex) => (
              <fieldset
                key={`${block.row}:${block.position}`}
                className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3"
              >
                <legend className="px-1 text-xs font-medium text-zinc-300">
                  {block.row}.{block.position} {block.device_name}
                </legend>
                <label className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                  Bypassed
                  <input
                    type="checkbox"
                    checked={block.bypassed}
                    onChange={(event) =>
                      updateBlock(blockIndex, { bypassed: event.target.checked })
                    }
                    className="size-4 accent-zinc-400"
                  />
                </label>
                {Object.entries(block.parameters).map(([name, value]) => (
                  <label
                    key={name}
                    className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 text-xs text-zinc-400"
                  >
                    <span className="truncate">{name}</span>
                    {typeof value === "boolean" ? (
                      <input
                        aria-label={`${block.device_name} ${name}`}
                        type="checkbox"
                        checked={value}
                        onChange={(event) =>
                          updateParameter(
                            blockIndex,
                            name,
                            event.target.checked,
                          )
                        }
                        className="size-4 justify-self-end accent-zinc-400"
                      />
                    ) : (
                      <input
                        aria-label={`${block.device_name} ${name}`}
                        type={typeof value === "number" ? "number" : "text"}
                        min={typeof value === "number" ? 0 : undefined}
                        max={typeof value === "number" ? 100 : undefined}
                        maxLength={typeof value === "string" ? 64 : undefined}
                        value={value}
                        required
                        onChange={(event) => {
                          if (
                            typeof value === "string" &&
                            !event.target.value.trim()
                          ) {
                            return;
                          }
                          updateParameter(
                            blockIndex,
                            name,
                            typeof value === "number"
                              ? Math.min(
                                  100,
                                  Math.max(0, Number(event.target.value)),
                                )
                              : event.target.value,
                          );
                        }}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
                      />
                    )}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
        <Usb className="mt-0.5 size-4 shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-400">
            {checkingDevice
              ? "Checking Quad Cortex transfer availability"
              : transferAvailable
                ? "Ready for read-only transfer preflight"
                : "Connect a Quad Cortex to transfer"}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Transfer is firmware-gated, uses the device&apos;s live model catalog,
            requires empty target cells, and verifies the complete result. Save
            current work before applying, then save the resulting preset on the
            QC to keep it.
          </p>
        </div>
        <button
          type="button"
          onClick={transferTone}
          disabled={checkingDevice || !transferAvailable || transferPhase !== null}
          className="flex min-w-32 items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {transferPhase && <Loader2 className="size-3.5 animate-spin" />}
          {transferPhase === "preflight"
            ? "Checking preset…"
            : transferPhase === "transfer"
              ? "Transferring…"
              : "Transfer to QC"}
        </button>
        {transferNotice && (
          <div
            className={`flex basis-full items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
              transferNotice.kind === "success"
                ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300"
                : "border-red-900/60 bg-red-950/30 text-red-300"
            }`}
            role={transferNotice.kind === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {transferNotice.kind === "success" ? (
              <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            )}
            {transferNotice.message}
          </div>
        )}
      </div>

      {/* Scenes */}
      {tone.scenes?.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
            <Layers className="w-4 h-4 text-zinc-500" />
            Scenes
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {tone.scenes.map((scene, i) => (
              <div
                key={i}
                className="rounded-xl bg-zinc-900/50 border border-zinc-800 p-4 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-zinc-800 text-[10px] font-mono flex items-center justify-center text-zinc-400">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <h4 className="text-sm font-medium text-zinc-200">
                    {scene.name}
                  </h4>
                </div>
                <p className="text-xs text-zinc-400">{scene.description}</p>
                {scene.changes.length > 0 && (
                  <ul className="space-y-1">
                    {scene.changes.map((change, j) => (
                      <li
                        key={j}
                        className="text-[11px] text-zinc-400 flex items-start gap-1.5"
                      >
                        <span className="text-zinc-700 mt-0.5">-</span>
                        {formatSceneChange(change)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tips */}
      {tone.tips?.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500/70" />
            Tips
          </h3>
          <div className="rounded-xl bg-zinc-900/50 border border-zinc-800 p-4">
            <ul className="space-y-2">
              {tone.tips.map((tip, i) => (
                <li
                  key={i}
                  className="text-sm text-zinc-400 flex items-start gap-2"
                >
                  <Tag className="w-3 h-3 mt-1 text-zinc-600 shrink-0" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
