import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { generateToneWithCodex } from "./codex-tone-generation";
import { getDeviceById } from "./devices";
import { GLM_MODEL, getGLMClient } from "./glm";
import { getTonePresetJsonSchema, tonePresetSchema } from "./tone-schema";
import { buildSystemPrompt } from "./tone-prompt";
import { getToneProvider } from "./tone-provider";
import type {
  ToneGenerationTarget,
  TonePluginLicense,
  TonePreset,
} from "./types";

export type ToneGenerationFailure =
  | "empty_response"
  | "invalid_json"
  | "invalid_tone";

export class ToneGenerationError extends Error {
  readonly code: ToneGenerationFailure;

  constructor(code: ToneGenerationFailure, message: string) {
    super(message);
    this.name = "ToneGenerationError";
    this.code = code;
  }
}

function getResponseFormat(): ChatCompletionCreateParamsNonStreaming["response_format"] {
  if (process.env.GLM_RESPONSE_FORMAT === "json_schema") {
    return {
      type: "json_schema",
      json_schema: {
        name: "qc_tone_preset",
        strict: true,
        schema: getTonePresetJsonSchema(),
      },
    };
  }

  return { type: "json_object" };
}

async function generateToneWithOpenAICompatible(
  prompt: string,
  target: ToneGenerationTarget,
  ownedPlugins: readonly TonePluginLicense[],
  signal?: AbortSignal,
): Promise<string> {
  const completion = await getGLMClient().chat.completions.create(
    {
      model: GLM_MODEL,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt("object", target, ownedPlugins),
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4_096,
      response_format: getResponseFormat(),
    },
    { signal },
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new ToneGenerationError(
      "empty_response",
      "The model returned no tone data",
    );
  }

  return content;
}

export function parseToneResponse(
  content: string,
  ownedPlugins: readonly TonePluginLicense[] = [],
): TonePreset {
  let candidate: unknown;
  try {
    candidate = JSON.parse(content);
  } catch {
    throw new ToneGenerationError(
      "invalid_json",
      "The model returned malformed JSON",
    );
  }

  const result = tonePresetSchema.safeParse(candidate);
  if (!result.success) {
    const summary = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "preset"}: ${issue.message}`)
      .join("; ");
    throw new ToneGenerationError(
      "invalid_tone",
      `The generated tone did not pass validation: ${summary}`,
    );
  }

  const enabledPlugins = new Set(ownedPlugins);
  const unavailableDevice = result.data.signal_chain.find((block) => {
    const requiredPlugin = getDeviceById(block.device_id)?.requiresPlugin;
    return requiredPlugin && !enabledPlugins.has(requiredPlugin);
  });
  if (unavailableDevice) {
    throw new ToneGenerationError(
      "invalid_tone",
      `${unavailableDevice.device_name} requires a plugin license that was not enabled`,
    );
  }

  return result.data;
}

export async function generateTone(
  prompt: string,
  signal?: AbortSignal,
  target: ToneGenerationTarget = "quad-cortex",
  ownedPlugins: readonly TonePluginLicense[] = [],
): Promise<TonePreset> {
  const content =
    getToneProvider() === "codex"
      ? await generateToneWithCodex(
          prompt,
          signal,
          undefined,
          target,
          ownedPlugins,
        )
      : await generateToneWithOpenAICompatible(
          prompt,
          target,
          ownedPlugins,
          signal,
        );

  const tone = parseToneResponse(content, ownedPlugins);
  return target === "final-cut-camera"
    ? { ...tone, recording_target: target }
    : tone;
}
