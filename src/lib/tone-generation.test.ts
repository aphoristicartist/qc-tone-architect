import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_TONE } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({
  codex: vi.fn(),
  create: vi.fn(),
}));

vi.mock("./codex-tone-generation", () => ({
  generateToneWithCodex: mocks.codex,
}));

vi.mock("./glm", () => ({
  GLM_MODEL: "test-model",
  getGLMClient: () => ({
    chat: { completions: { create: mocks.create } },
  }),
}));

import { generateTone, ToneGenerationError } from "./tone-generation";

describe("generateTone", () => {
  beforeEach(() => {
    vi.stubEnv("TONE_PROVIDER", "openai-compatible");
    mocks.codex.mockReset().mockResolvedValue(JSON.stringify(TEST_TONE));
    mocks.create.mockReset().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(TEST_TONE) } }],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses locally authenticated Codex by default", async () => {
    vi.stubEnv("TONE_PROVIDER", "codex");

    await expect(generateTone("A focused lead tone")).resolves.toEqual(TEST_TONE);
    expect(mocks.codex).toHaveBeenCalledWith(
      "A focused lead tone",
      undefined,
      undefined,
      "quad-cortex",
      [],
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns validated provider output", async () => {
    await expect(generateTone("A focused lead tone")).resolves.toEqual(TEST_TONE);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        response_format: { type: "json_object" },
      }),
      { signal: undefined },
    );
  });

  it("uses strict JSON Schema output when explicitly enabled", async () => {
    process.env.GLM_RESPONSE_FORMAT = "json_schema";

    await generateTone("A focused lead tone");

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: expect.objectContaining({
          type: "json_schema",
          json_schema: expect.objectContaining({ strict: true }),
        }),
      }),
      { signal: undefined },
    );
  });

  it("applies the Final Cut Camera profile to the prompt and result", async () => {
    const tone = await generateTone(
      "A spacious jazz sound",
      undefined,
      "final-cut-camera",
    );

    expect(tone.recording_target).toBe("final-cut-camera");
    const request = mocks.create.mock.calls[0][0];
    expect(request.messages[0].content).toContain(
      "IPHONE / FINAL CUT CAMERA PROFILE",
    );
    expect(request.messages[0].content).toContain(
      "QC processed stereo feed to USB 1/2",
    );
  });

  it("exposes and accepts licensed plugin devices only after explicit opt-in", async () => {
    await generateTone("A factory-only lead tone");
    expect(mocks.create.mock.calls[0][0].messages[0].content).not.toContain(
      "Rabea Lead [id: rabea-lead]",
    );

    const pluginTone = structuredClone(TEST_TONE);
    pluginTone.signal_chain[1] = {
      position: 2,
      row: 1,
      device_id: "rabea-lead",
      device_name: "Rabea Lead",
      role: "Licensed modern lead amplifier",
      bypassed: false,
      parameters: { GAIN: 58, BASS: 40, MIDDLE: 52, TREBLE: 61 },
    };
    pluginTone.scenes[0].changes[1].parameters = { GAIN: 48 };
    pluginTone.scenes[1].changes[1].parameters = { GAIN: 63 };
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(pluginTone) } }],
    });

    await expect(generateTone("A Rabea lead tone")).rejects.toMatchObject({
      code: "invalid_tone",
    } satisfies Partial<ToneGenerationError>);
    await expect(
      generateTone("A Rabea lead tone", undefined, "quad-cortex", [
        "archetype-rabea-x",
      ]),
    ).resolves.toEqual(pluginTone);
    expect(mocks.create.mock.calls.at(-1)?.[0].messages[0].content).toContain(
      "Rabea Lead [id: rabea-lead]",
    );
  });

  it("rejects malformed JSON", async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: "not-json" } }],
    });

    await expect(generateTone("A focused lead tone")).rejects.toMatchObject({
      code: "invalid_json",
    } satisfies Partial<ToneGenerationError>);
  });

  it("rejects JSON that violates the tone contract", async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ tone_name: "Incomplete" }) } }],
    });

    await expect(generateTone("A focused lead tone")).rejects.toMatchObject({
      code: "invalid_tone",
    } satisfies Partial<ToneGenerationError>);
  });
});
