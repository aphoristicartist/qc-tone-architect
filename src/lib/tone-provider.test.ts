import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getToneProvider,
  getToneProviderLabel,
  ToneProviderConfigurationError,
} from "./tone-provider";

describe("tone provider configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to Codex without requiring an API key", () => {
    vi.stubEnv("TONE_PROVIDER", "");
    vi.stubEnv("CODEX_MODEL", "");

    expect(getToneProvider()).toBe("codex");
    expect(getToneProviderLabel()).toBe("Codex");
  });

  it("labels explicitly selected providers", () => {
    vi.stubEnv("TONE_PROVIDER", "codex");
    vi.stubEnv("CODEX_MODEL", "gpt-5.4");
    expect(getToneProviderLabel()).toBe("Codex · gpt-5.4");

    vi.stubEnv("TONE_PROVIDER", "openai-compatible");
    vi.stubEnv("GLM_MODEL", "custom-model");
    expect(getToneProviderLabel()).toBe("custom-model");
  });

  it("rejects unknown providers without crashing the page label", () => {
    vi.stubEnv("TONE_PROVIDER", "unknown");

    expect(() => getToneProvider()).toThrow(ToneProviderConfigurationError);
    expect(getToneProviderLabel()).toBe("Provider misconfigured");
  });
});
