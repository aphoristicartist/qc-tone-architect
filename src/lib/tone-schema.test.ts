import { describe, expect, it } from "vitest";

import { TEST_TONE } from "@/test/fixtures";

import { getTonePresetJsonSchema, tonePresetSchema } from "./tone-schema";

describe("tonePresetSchema", () => {
  it("accepts a complete, internally consistent preset", () => {
    expect(tonePresetSchema.parse(TEST_TONE)).toEqual(TEST_TONE);
  });

  it("rejects unknown devices", () => {
    const tone = structuredClone(TEST_TONE);
    tone.signal_chain[0].device_id = "invented-pedal";

    const result = tonePresetSchema.safeParse(tone);

    expect(result.success).toBe(false);
  });

  it("rejects duplicate grid positions", () => {
    const tone = structuredClone(TEST_TONE);
    tone.signal_chain[1].position = tone.signal_chain[0].position;

    const result = tonePresetSchema.safeParse(tone);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("used more than once"))).toBe(true);
    }
  });

  it("requires both an amplifier and cabinet", () => {
    const tone = structuredClone(TEST_TONE);
    tone.signal_chain = tone.signal_chain.filter(
      (block) => block.device_id !== "ca-jp2c",
    );

    const result = tonePresetSchema.safeParse(tone);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("contain an amp"))).toBe(true);
    }
  });

  it("rejects scene changes for empty grid slots", () => {
    const tone = structuredClone(TEST_TONE);
    tone.scenes[0].changes[0].position = 8;

    const result = tonePresetSchema.safeParse(tone);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("empty grid slot"))).toBe(true);
    }
  });

  it("rejects scene parameters absent from the referenced block", () => {
    const tone = structuredClone(TEST_TONE);
    tone.scenes[0].changes[1].parameters = { presence: 50 };

    const result = tonePresetSchema.safeParse(tone);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("is not defined on block"),
        ),
      ).toBe(true);
    }
  });

  it("rejects unprofiled devices and unsafe control names or types", () => {
    const unprofiled = structuredClone(TEST_TONE);
    unprofiled.signal_chain[0] = {
      ...unprofiled.signal_chain[0],
      device_id: "precision-drive",
      device_name: "Precision Drive",
    };
    expect(tonePresetSchema.safeParse(unprofiled).success).toBe(false);

    const unknownControl = structuredClone(TEST_TONE);
    unknownControl.signal_chain[0].parameters.UNKNOWN = 50;
    expect(tonePresetSchema.safeParse(unknownControl).success).toBe(false);

    const wrongType = structuredClone(TEST_TONE);
    wrongType.signal_chain[3].parameters.SYNC = 50;
    expect(tonePresetSchema.safeParse(wrongType).success).toBe(false);
  });

  it("rejects scene bypass because new block bypass mode is not host-writable", () => {
    const tone = structuredClone(TEST_TONE);
    Object.assign(tone.scenes[0].changes[0], { bypassed: true });

    expect(tonePresetSchema.safeParse(tone).success).toBe(false);
  });

  it("produces a JSON schema for providers that support strict output", () => {
    const schema = getTonePresetJsonSchema();

    expect(schema).toMatchObject({ type: "object" });
    expect(schema).toHaveProperty("properties.signal_chain");
  });
});
