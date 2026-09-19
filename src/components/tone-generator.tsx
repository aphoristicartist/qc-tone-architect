"use client";

import { useEffect, useState, useRef } from "react";
import {
  type ToneGenerationTarget,
  type TonePreset,
} from "@/lib/types";
import { CAMERA_READY_PRESETS } from "@/lib/camera-ready-presets";
import {
  clearStoredToneHistory,
  createToneHistoryEntry,
  loadToneHistory,
  saveToneHistory,
  type ToneHistoryEntry,
} from "@/lib/tone-history";
import ToneResult from "./tone-result";
import {
  Send,
  Loader2,
  Guitar,
  Flame,
  Sparkles,
  Music,
  Trash2,
  Smartphone,
  Cpu,
} from "lucide-react";

const SUGGESTIONS = [
  { label: "Plini clean", icon: Sparkles, prompt: "I want a Plini-style clean tone with lush reverb and subtle drive, responsive to picking dynamics" },
  { label: "Rammstein", icon: Flame, prompt: "Heavy Rammstein industrial metal tone with tight low end, scooped mids, and aggressive distortion" },
  { label: "Gilmour lead", icon: Music, prompt: "David Gilmour soaring lead tone with Big Muff fuzz, long delay, and hall reverb" },
  { label: "John Mayer blues", icon: Guitar, prompt: "John Mayer bluesy tone, warm Fender amp with Klon drive, spring reverb" },
  { label: "Metallica rhythm", icon: Flame, prompt: "Metallica Master of Puppets rhythm tone, tight and aggressive with Mesa Mark IIC+" },
  { label: "Ambient post-rock", icon: Sparkles, prompt: "Ambient post-rock tone with shimmer reverb, long delays, and clean amp" },
];

export default function ToneGenerator() {
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] =
    useState<ToneGenerationTarget>("quad-cortex");
  const [includeRabeaX, setIncludeRabeaX] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TonePreset | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ToneHistoryEntry[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHistory(loadToneHistory());
    return () => activeRequestRef.current?.abort();
  }, []);

  function updateHistory(update: (current: ToneHistoryEntry[]) => ToneHistoryEntry[]) {
    setHistory((current) => {
      const next = update(current).slice(0, 20);
      saveToneHistory(next);
      return next;
    });
  }

  async function generate(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    activeRequestRef.current = controller;

    try {
      const res = await fetch("/api/generate-tone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          target,
          owned_plugins: includeRabeaX ? ["archetype-rabea-x"] : [],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `API error ${res.status}`);
      }

      const tone: TonePreset = await res.json();
      const historyEntry = createToneHistoryEntry(trimmed, tone);
      setResult(tone);
      setSelectedHistoryId(historyEntry.id);
      updateHistory((current) => [
        historyEntry,
        ...current,
      ]);
      setPrompt("");
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setLoading(false);
      }
    }
  }

  function openCameraPreset(recipe: (typeof CAMERA_READY_PRESETS)[number]) {
    if (loading) return;
    const tone = structuredClone(recipe.tone);
    const historyEntry = createToneHistoryEntry(
      `Camera-ready recipe: ${recipe.shortName}`,
      tone,
    );
    setTarget("final-cut-camera");
    setResult(tone);
    setSelectedHistoryId(historyEntry.id);
    setError(null);
    updateHistory((current) => [historyEntry, ...current]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      generate(prompt);
    }
  }

  function handleToneChange(tone: TonePreset) {
    setResult(tone);
    if (!selectedHistoryId) return;
    updateHistory((current) =>
      current.map((entry) =>
        entry.id === selectedHistoryId ? { ...entry, tone } : entry,
      ),
    );
  }

  return (
    <div className="space-y-8">
      {/* Input area */}
      <div className="space-y-4">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-xs uppercase tracking-wider text-zinc-400">
            Output target
          </legend>
          <button
            type="button"
            aria-pressed={target === "quad-cortex"}
            onClick={() => setTarget("quad-cortex")}
            disabled={loading}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              target === "quad-cortex"
                ? "border-zinc-600 bg-zinc-800/60 text-white"
                : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Cpu className="size-4" />
              Quad Cortex
            </span>
            <span className="mt-1 block text-[11px] text-zinc-400">
              General-purpose preset with no camera-specific constraints.
            </span>
          </button>
          <button
            type="button"
            aria-pressed={target === "final-cut-camera"}
            onClick={() => setTarget("final-cut-camera")}
            disabled={loading}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              target === "final-cut-camera"
                ? "border-emerald-700/70 bg-emerald-950/30 text-emerald-100"
                : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Smartphone className="size-4" />
              iPhone / Final Cut Camera
            </span>
            <span className="mt-1 block text-[11px] text-zinc-400">
              Finished stereo QC sound, balanced scenes, and recording headroom.
            </span>
          </button>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-left">
          <input
            type="checkbox"
            checked={includeRabeaX}
            onChange={(event) => setIncludeRabeaX(event.target.checked)}
            disabled={loading}
            className="mt-0.5 size-4 accent-emerald-500"
          />
          <span>
            <span className="block text-xs font-medium text-zinc-200">
              Include Archetype: Rabea X devices
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">
              Enable only if your Quad Cortex has a valid Rabea X license.
            </span>
          </span>
        </label>

        {target === "final-cut-camera" && !result && !loading && (
          <section aria-labelledby="camera-recipes-heading" className="space-y-2">
            <div>
              <h2
                id="camera-recipes-heading"
                className="text-xs uppercase tracking-wider text-zinc-400"
              >
                Camera-ready presets
              </h2>
              <p className="mt-1 text-[11px] text-zinc-400">
                Verified device recipes you can open instantly—no generation wait.
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {CAMERA_READY_PRESETS.map((recipe) => (
                <button
                  type="button"
                  key={recipe.slug}
                  onClick={() => openCameraPreset(recipe)}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-left transition-colors hover:border-emerald-800/70 hover:bg-zinc-900"
                >
                  <span className="text-sm font-medium text-zinc-200">
                    {recipe.shortName}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-zinc-400">
                    {recipe.summary}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="relative">
          <label htmlFor="tone-prompt" className="sr-only">
            Describe your desired sound
          </label>
          <textarea
            id="tone-prompt"
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the sound you want... (e.g., 'tight modern rhythm', 'warm jazz bass', or 'ambient post-rock texture')"
            rows={3}
            maxLength={1_000}
            aria-describedby="tone-prompt-count"
            disabled={loading}
            className="w-full rounded-2xl bg-zinc-900/80 border border-zinc-700/50 px-5 py-4 pr-14 text-sm text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30 resize-none transition-all disabled:opacity-50"
          />
          <button
            type="button"
            aria-label="Generate tone"
            onClick={() => generate(prompt)}
            disabled={loading || !prompt.trim()}
            className="absolute right-3 bottom-3 w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 flex items-center justify-center transition-all"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-zinc-300" />
            )}
          </button>
          <span
            id="tone-prompt-count"
            className="absolute left-5 bottom-3 text-[10px] text-zinc-400"
            aria-live="polite"
          >
            {prompt.length}/1000
          </span>
        </div>

        {/* Quick suggestions */}
        {!result && !loading && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                type="button"
                key={s.label}
                onClick={() => {
                  setPrompt(s.prompt);
                  generate(s.prompt);
                }}
                className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/60 border border-zinc-700/40 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800 transition-all"
              >
                <s.icon className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
                {s.label}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-red-950/30 border border-red-900/50 px-4 py-3 text-sm text-red-400"
          >
            {error}
          </div>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 space-y-4 animate-in fade-in duration-300">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-2 border-zinc-800 border-t-zinc-500 animate-spin" />
            <Guitar className="w-6 h-6 text-zinc-500 absolute inset-0 m-auto" />
          </div>
          <p className="text-sm text-zinc-400">
            Designing your tone...
          </p>
          <button
            type="button"
            onClick={() => activeRequestRef.current?.abort()}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <ToneResult
          key={selectedHistoryId ?? result.tone_name}
          tone={result}
          onChange={handleToneChange}
        />
      )}

      {/* History */}
      {history.length > 0 && !loading && (
        <div className="space-y-3 pt-4 border-t border-zinc-800/50">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs uppercase tracking-wider text-zinc-400">
              Saved tones
            </h3>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Clear all saved tones? This cannot be undone.")) {
                  return;
                }
                clearStoredToneHistory();
                setHistory([]);
                setSelectedHistoryId(null);
              }}
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear history
            </button>
          </div>
          <div className="space-y-2">
            {history.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setResult(item.tone);
                  if (item.tone.recording_target) {
                    setTarget(item.tone.recording_target);
                  }
                  setSelectedHistoryId(item.id);
                }}
                aria-current={selectedHistoryId === item.id ? "true" : undefined}
                className="w-full text-left rounded-xl bg-zinc-900/30 border border-zinc-800/50 px-4 py-3 hover:bg-zinc-900/60 hover:border-zinc-700/50 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100">
                    {item.tone.tone_name}
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    {item.tone.genre_tags?.slice(0, 3).join(" / ")}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 truncate">
                  {item.prompt}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
