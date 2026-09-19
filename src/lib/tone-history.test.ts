import { describe, expect, it } from "vitest";

import { TEST_TONE } from "@/test/fixtures";

import {
  clearStoredToneHistory,
  createToneHistoryEntry,
  loadToneHistory,
  saveToneHistory,
} from "./tone-history";

describe("tone history", () => {
  it("persists and restores validated tones", () => {
    const entry = createToneHistoryEntry("A focused lead tone", TEST_TONE);

    saveToneHistory([entry]);

    expect(loadToneHistory()).toEqual([entry]);
  });

  it("ignores malformed or obsolete storage", () => {
    window.localStorage.setItem("qc-tone-architect:history:v2", "{bad-json");
    expect(loadToneHistory()).toEqual([]);

    window.localStorage.setItem(
      "qc-tone-architect:history:v2",
      JSON.stringify([{ not: "a tone" }]),
    );
    expect(loadToneHistory()).toEqual([]);
  });

  it("clears stored history", () => {
    saveToneHistory([
      createToneHistoryEntry("A focused lead tone", TEST_TONE),
    ]);

    clearStoredToneHistory();

    expect(loadToneHistory()).toEqual([]);
  });
});
