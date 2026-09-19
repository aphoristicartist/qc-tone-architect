import { describe, expect, it } from "vitest";

import { assessCameraReadiness } from "./camera-readiness";
import { CAMERA_READY_PRESETS } from "./camera-ready-presets";
import { QC_DEVICES } from "./devices";
import { tonePresetSchema } from "./tone-schema";

describe("camera-ready preset library", () => {
  it("ships three valid and camera-ready recipes", () => {
    expect(CAMERA_READY_PRESETS.map((recipe) => recipe.slug)).toEqual([
      "modern-jazz",
      "modern-fusion",
      "modern-ambient",
    ]);

    for (const recipe of CAMERA_READY_PRESETS) {
      expect(tonePresetSchema.safeParse(recipe.tone).success).toBe(true);
      expect(assessCameraReadiness(recipe.tone).ready).toBe(true);
      expect(recipe.tone.signal_chain).not.toContainEqual(
        expect.objectContaining({ device_id: "ir-loader" }),
      );
    }
  });

  it("contains every native CorOS 4.1 device profile", () => {
    const expected = new Map([
      ["plugin-parametric-4", 4008],
      ["douglas-shining-comp-m", 5025],
      ["crystal-delay", 6026],
      ["arpeggio-delay", 6031],
      ["vintage-digital", 8039],
      ["multivoicer", 18012],
      ["glitch", 26005],
      ["ring-modulator", 26006],
    ]);

    for (const [id, modelId] of expected) {
      expect(QC_DEVICES.find((device) => device.id === id)).toMatchObject({
        qcModelId: modelId,
      });
    }
  });

  it("flags camera tones without per-scene level compensation", () => {
    const tone = structuredClone(CAMERA_READY_PRESETS[0].tone);
    tone.scenes[0].changes = tone.scenes[0].changes.filter(
      (change) => change.position !== 3,
    );

    const report = assessCameraReadiness(tone);

    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.id === "scene-levels")?.status).toBe(
      "review",
    );
  });
});
