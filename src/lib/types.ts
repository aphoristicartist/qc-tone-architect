export type ToneParameterValue = string | number | boolean;

export const TONE_GENERATION_TARGETS = [
  "quad-cortex",
  "final-cut-camera",
] as const;

export type ToneGenerationTarget = (typeof TONE_GENERATION_TARGETS)[number];

export const TONE_PLUGIN_LICENSES = ["archetype-rabea-x"] as const;

export type TonePluginLicense = (typeof TONE_PLUGIN_LICENSES)[number];

export interface ToneBlock {
  position: number;
  row: number;
  device_id: string;
  device_name: string;
  role: string;
  bypassed: boolean;
  parameters: Record<string, ToneParameterValue>;
}

export interface ToneSceneChange {
  row: number;
  position: number;
  parameters: Record<string, ToneParameterValue>;
}

export interface ToneScene {
  name: string;
  description: string;
  changes: ToneSceneChange[];
}

export interface TonePreset {
  recording_target?: ToneGenerationTarget;
  tone_name: string;
  description: string;
  inspiration: string;
  signal_chain: ToneBlock[];
  scenes: ToneScene[];
  tips: string[];
  genre_tags: string[];
}
