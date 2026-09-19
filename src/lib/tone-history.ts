import { z } from "zod";

import { tonePresetSchema } from "./tone-schema";
import type { TonePreset } from "./types";

const STORAGE_KEY = "qc-tone-architect:history:v2";
const HISTORY_LIMIT = 20;

export interface ToneHistoryEntry {
  id: string;
  prompt: string;
  tone: TonePreset;
  createdAt: string;
}

const historyEntrySchema = z
  .object({
    id: z.string().min(1).max(100),
    prompt: z.string().min(1).max(1_000),
    tone: tonePresetSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();

const toneHistorySchema = z.array(historyEntrySchema).max(HISTORY_LIMIT);

function storageAvailable(): boolean {
  return typeof window !== "undefined" && window.localStorage !== undefined;
}

export function loadToneHistory(): ToneHistoryEntry[] {
  if (!storageAvailable()) return [];

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const result = toneHistorySchema.safeParse(JSON.parse(stored));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function saveToneHistory(entries: ToneHistoryEntry[]): boolean {
  if (!storageAvailable()) return false;
  try {
    const validEntries = toneHistorySchema.parse(entries.slice(0, HISTORY_LIMIT));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(validEntries));
    return true;
  } catch {
    return false;
  }
}

export function createToneHistoryEntry(
  prompt: string,
  tone: TonePreset,
): ToneHistoryEntry {
  return {
    id: crypto.randomUUID(),
    prompt,
    tone,
    createdAt: new Date().toISOString(),
  };
}

export function clearStoredToneHistory(): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Browsers may disable storage in private or hardened contexts.
  }
}
