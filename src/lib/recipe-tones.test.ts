import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { tonePresetSchema } from "./tone-schema";
import { TURKISH_OUD_TONE } from "./recipe-tones";

describe("built-in recipe tones", () => {
  it("keeps the Turkish oud recipe transfer-safe", () => {
    expect(tonePresetSchema.parse(TURKISH_OUD_TONE)).toEqual(
      TURKISH_OUD_TONE,
    );
  });

  it("keeps the committed Turkish oud example synchronized", async () => {
    const example = JSON.parse(
      await readFile("examples/turkish-oud.json", "utf8"),
    );

    expect(tonePresetSchema.parse(example)).toEqual(TURKISH_OUD_TONE);
  });
});
