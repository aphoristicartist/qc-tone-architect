import { getDeviceById } from "./devices";
import type { TonePreset } from "./types";

export interface CameraReadinessCheck {
  id: "target" | "routing" | "scenes" | "scene-levels" | "headroom" | "space";
  label: string;
  detail: string;
  status: "pass" | "review";
}

export interface CameraReadinessReport {
  ready: boolean;
  checks: CameraReadinessCheck[];
}

const SCENE_NAMES = ["clean", "wide", "lead", "ambient"] as const;
const AMP_LEVEL_CONTROLS = new Set(["LEVEL", "MASTER", "OUTPUT", "VOLUME"]);
const OUTPUT_CONTROLS = new Set([
  "GLOBAL OUTPUT",
  "LEVEL",
  "MASTER",
  "OUTPUT",
  "VOLUME",
]);

function numericValues(
  tone: TonePreset,
  parameterNames: ReadonlySet<string>,
): number[] {
  const values: number[] = [];
  for (const block of tone.signal_chain) {
    for (const [name, value] of Object.entries(block.parameters)) {
      if (parameterNames.has(name) && typeof value === "number") values.push(value);
    }
  }
  for (const scene of tone.scenes) {
    for (const change of scene.changes) {
      for (const [name, value] of Object.entries(change.parameters)) {
        if (parameterNames.has(name) && typeof value === "number") {
          values.push(value);
        }
      }
    }
  }
  return values;
}

function parameterValuesForBlocks(
  tone: TonePreset,
  blocks: TonePreset["signal_chain"],
  parameterName: string,
): number[] {
  const slots = new Set(blocks.map((block) => `${block.row}:${block.position}`));
  const values: number[] = [];
  for (const block of blocks) {
    const value = block.parameters[parameterName];
    if (typeof value === "number") values.push(value);
  }
  for (const scene of tone.scenes) {
    for (const change of scene.changes) {
      if (!slots.has(`${change.row}:${change.position}`)) continue;
      const value = change.parameters[parameterName];
      if (typeof value === "number") values.push(value);
    }
  }
  return values;
}

export function assessCameraReadiness(tone: TonePreset): CameraReadinessReport {
  const checks: CameraReadinessCheck[] = [];
  const add = (
    id: CameraReadinessCheck["id"],
    label: string,
    pass: boolean,
    success: string,
    review: string,
  ) => {
    checks.push({
      id,
      label,
      detail: pass ? success : review,
      status: pass ? "pass" : "review",
    });
  };

  add(
    "target",
    "Final Cut target",
    tone.recording_target === "final-cut-camera",
    "The preset was designed for a finished QC-to-iPhone recording path.",
    "Regenerate with the iPhone / Final Cut Camera target before recording.",
  );

  const rowOneOnly = tone.signal_chain.every((block) => block.row === 1);
  add(
    "routing",
    "Single dependable path",
    rowOneOnly,
    "Every block is on one contiguous camera-friendly row.",
    "Parallel rows need a manual QC routing check before recording.",
  );

  const sceneNames = tone.scenes.map((scene) => scene.name.trim().toLowerCase());
  const completeScenes =
    sceneNames.length === SCENE_NAMES.length &&
    SCENE_NAMES.every((name) => sceneNames.includes(name));
  add(
    "scenes",
    "Four performance scenes",
    completeScenes,
    "Clean, Wide, Lead, and Ambient are ready for one-take switching.",
    "Use four scenes named Clean, Wide, Lead, and Ambient for the camera workflow.",
  );

  const amp = tone.signal_chain.find(
    (block) => getDeviceById(block.device_id)?.category === "amp",
  );
  const sceneLevelsMatched =
    amp !== undefined &&
    tone.scenes.length > 0 &&
    tone.scenes.every((scene) =>
      scene.changes.some(
        (change) =>
          change.row === amp.row &&
          change.position === amp.position &&
          Object.keys(change.parameters).some((name) =>
            AMP_LEVEL_CONTROLS.has(name),
          ),
      ),
    );
  add(
    "scene-levels",
    "Scene level compensation",
    sceneLevelsMatched,
    "Every scene explicitly controls the amp level for repeatable camera gain.",
    "At least one scene lacks an explicit amp level; compare it before the take.",
  );

  const outputValues = numericValues(tone, OUTPUT_CONTROLS);
  const outputHeadroom =
    outputValues.length > 0 && outputValues.every((value) => value <= 70);
  add(
    "headroom",
    "Output headroom",
    outputHeadroom,
    "All exposed output controls stay at or below the camera profile ceiling.",
    "An exposed output control exceeds 70 or no output control is available; meter the loudest scene carefully.",
  );

  const wetBlocks = tone.signal_chain.filter((block) => {
    const category = getDeviceById(block.device_id)?.category;
    return category === "delay" || category === "reverb";
  });
  const wetMixValues = parameterValuesForBlocks(tone, wetBlocks, "MIX");
  const controlledSpace =
    wetBlocks.length > 0 &&
    wetMixValues.length > 0 &&
    wetMixValues.every((value) => value <= 50);
  add(
    "space",
    "Controlled modern space",
    controlledSpace,
    "Stereo delay/reverb is present and each MIX value stays at or below 50.",
    "Add a stereo delay/reverb or reduce an individual MIX value above 50.",
  );

  return {
    ready: checks.every((check) => check.status === "pass"),
    checks,
  };
}
