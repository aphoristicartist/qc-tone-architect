import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { tonePresetSchema } from "../lib/tone-schema";
import { TURKISH_OUD_TONE } from "../lib/recipe-tones";

const run = promisify(execFile);

describe("qc-tone CLI", () => {
  it("emits a valid built-in recipe", async () => {
    const { stdout } = await run(process.execPath, [
      "bin/qc-tone.mjs",
      "recipe",
      "turkish-oud",
    ]);

    expect(tonePresetSchema.parse(JSON.parse(stdout))).toEqual(
      TURKISH_OUD_TONE,
    );
  });

  it("refuses hardware transfer without the exact confirmation", async () => {
    await expect(
      run(process.execPath, [
        "bin/qc-tone.mjs",
        "transfer",
        "examples/turkish-oud.json",
      ]),
    ).rejects.toThrow(/Transfer requires --confirmation/);
  });
});
