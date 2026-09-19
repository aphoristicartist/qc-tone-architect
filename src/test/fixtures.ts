import type { TonePreset } from "@/lib/types";

export const TEST_TONE: TonePreset = {
  tone_name: "Focused Modern Lead",
  description:
    "A tight modern lead sound with articulate pick attack and a spacious tail.",
  inspiration: "Progressive instrumental rock",
  signal_chain: [
    {
      position: 1,
      row: 1,
      device_id: "ts808",
      device_name: "TS808",
      role: "Tight boost before the amp",
      bypassed: false,
      parameters: { OVERDRIVE: 12, TONE: 55, LEVEL: 72 },
    },
    {
      position: 2,
      row: 1,
      device_id: "ca-jp2c",
      device_name: "CA JP-2C",
      role: "Focused high-gain voice",
      bypassed: false,
      parameters: { GAIN: 58, BASS: 40, MID: 52, TREBLE: 61 },
    },
    {
      position: 3,
      row: 1,
      device_id: "cab-4x12-mesa-recto",
      device_name: "4x12 CA Recto",
      role: "Tight V30-style cabinet",
      bypassed: false,
      parameters: {},
    },
    {
      position: 4,
      row: 1,
      device_id: "digital-delay",
      device_name: "Digital Delay",
      role: "Clear lead repeats",
      bypassed: false,
      parameters: { MIX: 24, FEEDBACK: 34, SYNC: true, TRAILS: true },
    },
  ],
  scenes: [
    {
      name: "Rhythm",
      description: "Dry and tight rhythm sound.",
      changes: [
        { row: 1, position: 4, parameters: { MIX: 0 } },
        { row: 1, position: 2, parameters: { GAIN: 48 } },
      ],
    },
    {
      name: "Lead",
      description: "Adds delay and more amp gain.",
      changes: [
        { row: 1, position: 4, parameters: { MIX: 24 } },
        { row: 1, position: 2, parameters: { GAIN: 63 } },
      ],
    },
  ],
  tips: ["Adjust the gate threshold for the guitar you are using."],
  genre_tags: ["progressive", "lead"],
};
