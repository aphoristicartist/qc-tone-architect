import { describe, expect, it } from "vitest";

import { getDeviceListForPrompt, QC_DEVICES } from "./devices";

describe("transfer-backed device profiles", () => {
  it("uses unique firmware model IDs and control names", () => {
    const profiled = QC_DEVICES.filter(
      (device) =>
        device.qcModelId !== undefined && device.parameters !== undefined,
    );
    const modelIds = profiled.map((device) => device.qcModelId);

    expect(profiled.length).toBeGreaterThanOrEqual(30);
    expect(new Set(modelIds).size).toBe(modelIds.length);
    for (const device of profiled) {
      const names = device.parameters!.map((parameter) => parameter.name);
      expect(new Set(names).size).toBe(names.length);
      expect(names.every((name) => /^[A-Z][A-Z0-9_]*$/.test(name))).toBe(true);
    }
  });

  it("only exposes firmware-backed devices and typed controls to generation", () => {
    const promptList = getDeviceListForPrompt();

    expect(promptList).toContain("TS808 [id: ts808]");
    expect(promptList).toContain("OVERDRIVE:0-100");
    expect(promptList).toContain("SYNC:boolean");
    expect(promptList).toContain("Overlord Synth [id: rabea-overlord-synth]");
    expect(promptList).not.toContain("Rabea Lead [id: rabea-lead]");
    expect(promptList).not.toContain("Precision Drive [id: precision-drive]");
    expect(promptList).not.toContain("IR Loader [id: ir-loader]");

    const withRabea = getDeviceListForPrompt(["archetype-rabea-x"]);
    expect(withRabea).toContain("Rabea Lead [id: rabea-lead]");
    expect(withRabea).toContain("Rabea Atlas Delay [id: rabea-atlas-delay]");
  });
});
