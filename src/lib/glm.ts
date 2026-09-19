import OpenAI from "openai";

export const GLM_MODEL = process.env.GLM_MODEL || "glm-5.1";

let client: OpenAI | undefined;

export class GLMConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GLMConfigurationError";
  }
}

export function getGLMClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.GLM_API_KEY?.trim();
  if (!apiKey) {
    throw new GLMConfigurationError(
      "GLM_API_KEY is not configured on the server",
    );
  }

  const timeout = Number(process.env.GLM_TIMEOUT_MS ?? 45_000);
  if (!Number.isFinite(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw new GLMConfigurationError(
      "GLM_TIMEOUT_MS must be between 1000 and 120000",
    );
  }

  client = new OpenAI({
    apiKey,
    baseURL:
      process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4/",
    maxRetries: 2,
    timeout,
  });

  return client;
}

export function resetGLMClientForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The GLM client can only be reset in tests");
  }
  client = undefined;
}
