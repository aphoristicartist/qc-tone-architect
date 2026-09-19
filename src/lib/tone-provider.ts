export const TONE_PROVIDERS = ["codex", "openai-compatible"] as const;

export type ToneProvider = (typeof TONE_PROVIDERS)[number];

export class ToneProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToneProviderConfigurationError";
  }
}

export function getToneProvider(): ToneProvider {
  const value = process.env.TONE_PROVIDER?.trim() || "codex";
  if ((TONE_PROVIDERS as readonly string[]).includes(value)) {
    return value as ToneProvider;
  }

  throw new ToneProviderConfigurationError(
    `TONE_PROVIDER must be one of: ${TONE_PROVIDERS.join(", ")}`,
  );
}

export function getToneProviderLabel(): string {
  try {
    if (getToneProvider() === "codex") {
      const model = process.env.CODEX_MODEL?.trim();
      return model ? `Codex · ${model}` : "Codex";
    }

    return process.env.GLM_MODEL?.trim() || "OpenAI-compatible";
  } catch {
    return "Provider misconfigured";
  }
}
