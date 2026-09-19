import { z } from "zod";

import { QC_DEVICES } from "./devices";
import {
  TONE_GENERATION_TARGETS,
  TONE_PLUGIN_LICENSES,
  type TonePreset,
} from "./types";

const deviceIds = QC_DEVICES.filter(
  (device) => device.qcModelId !== undefined && device.parameters !== undefined,
).map((device) => device.id) as [string, ...string[]];
const deviceIdSchema = z.enum(deviceIds);
const deviceById = new Map(QC_DEVICES.map((device) => [device.id, device]));

const trimmedString = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
      message: "Control characters are not allowed",
    });

export const toneParameterValueSchema = z.union([
  z.number().finite().min(0).max(100),
  trimmedString(1, 64),
  z.boolean(),
]);

const toneParametersSchema = z
  .record(trimmedString(1, 64), toneParameterValueSchema)
  .refine((parameters) => Object.keys(parameters).length <= 32, {
    message: "A block cannot contain more than 32 parameters",
  });

export const toneBlockSchema = z
  .object({
    position: z.number().int().min(1).max(8),
    row: z.number().int().min(1).max(4),
    device_id: deviceIdSchema,
    device_name: trimmedString(1, 100),
    role: trimmedString(1, 160),
    bypassed: z.boolean(),
    parameters: toneParametersSchema,
  })
  .strict()
  .superRefine((block, context) => {
    const device = deviceById.get(block.device_id);
    if (device && device.name !== block.device_name) {
      context.addIssue({
        code: "custom",
        path: ["device_name"],
        message: `Expected device name \"${device.name}\" for ${block.device_id}`,
      });
    }
    if (device?.parameters) {
      const specifications = new Map(
        device.parameters.map((parameter) => [parameter.name, parameter]),
      );
      for (const [name, value] of Object.entries(block.parameters)) {
        const specification = specifications.get(name);
        if (!specification) {
          context.addIssue({
            code: "custom",
            path: ["parameters", name],
            message: `${name} is not a transfer-safe control for ${device.name}`,
          });
          continue;
        }
        const correctType =
          (specification.kind === "switch" && typeof value === "boolean") ||
          (specification.kind === "position" && typeof value === "number") ||
          (specification.kind === "text" && typeof value === "string");
        if (!correctType) {
          context.addIssue({
            code: "custom",
            path: ["parameters", name],
            message:
              specification.kind === "switch"
                ? `${name} must be true or false`
                : specification.kind === "text"
                  ? `${name} must be text`
                  : `${name} must be a 0-100 position`,
          });
        }
      }
    }
  });

export const toneSceneChangeSchema = z
  .object({
    row: z.number().int().min(1).max(4),
    position: z.number().int().min(1).max(8),
    parameters: toneParametersSchema.refine(
      (parameters) => Object.keys(parameters).length > 0,
      { message: "A scene change must update at least one parameter" },
    ),
  })
  .strict();

export const toneSceneSchema = z
  .object({
    name: trimmedString(1, 40),
    description: trimmedString(1, 240),
    changes: z.array(toneSceneChangeSchema).max(32),
  })
  .strict();

export const tonePresetSchema: z.ZodType<TonePreset> = z
  .object({
    recording_target: z.enum(TONE_GENERATION_TARGETS).optional(),
    tone_name: trimmedString(1, 80),
    description: trimmedString(1, 600),
    inspiration: trimmedString(1, 200),
    signal_chain: z.array(toneBlockSchema).min(2).max(32),
    scenes: z.array(toneSceneSchema).max(8),
    tips: z.array(trimmedString(1, 280)).max(12),
    genre_tags: z.array(trimmedString(1, 40)).max(10),
  })
  .strict()
  .superRefine((preset, context) => {
    const occupiedSlots = new Set<string>();
    const blockBySlot = new Map<string, TonePreset["signal_chain"][number]>();
    let hasAmp = false;
    let hasCab = false;

    preset.signal_chain.forEach((block, index) => {
      const slot = `${block.row}:${block.position}`;
      if (occupiedSlots.has(slot)) {
        context.addIssue({
          code: "custom",
          path: ["signal_chain", index, "position"],
          message: `Grid slot ${slot} is used more than once`,
        });
      }
      occupiedSlots.add(slot);
      blockBySlot.set(slot, block);

      const category = deviceById.get(block.device_id)?.category;
      hasAmp ||= category === "amp";
      hasCab ||= category === "cab";
    });

    if (!hasAmp) {
      context.addIssue({
        code: "custom",
        path: ["signal_chain"],
        message: "The signal chain must contain an amp",
      });
    }
    if (!hasCab) {
      context.addIssue({
        code: "custom",
        path: ["signal_chain"],
        message: "The signal chain must contain a cab",
      });
    }

    preset.scenes.forEach((scene, sceneIndex) => {
      scene.changes.forEach((change, changeIndex) => {
        const slot = `${change.row}:${change.position}`;
        if (!occupiedSlots.has(slot)) {
          context.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "changes", changeIndex],
            message: `Scene change refers to empty grid slot ${slot}`,
          });
        }
        const block = blockBySlot.get(slot);
        const device = block ? deviceById.get(block.device_id) : undefined;
        const specifications = new Map(
          (device?.parameters ?? []).map((parameter) => [
            parameter.name,
            parameter,
          ]),
        );
        for (const [parameterName, value] of Object.entries(
          change.parameters ?? {},
        )) {
          if (
            block &&
            !Object.prototype.hasOwnProperty.call(
              block.parameters,
              parameterName,
            )
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "scenes",
                sceneIndex,
                "changes",
                changeIndex,
                "parameters",
                parameterName,
              ],
              message: `Scene parameter ${parameterName} is not defined on block ${slot}`,
            });
            continue;
          }
          const specification = specifications.get(parameterName);
          if (specification) {
            const correctType =
              (specification.kind === "switch" &&
                typeof value === "boolean") ||
              (specification.kind === "position" &&
                typeof value === "number") ||
              (specification.kind === "text" && typeof value === "string");
            if (!correctType) {
              context.addIssue({
                code: "custom",
                path: [
                  "scenes",
                  sceneIndex,
                  "changes",
                  changeIndex,
                  "parameters",
                  parameterName,
                ],
                message:
                  specification.kind === "switch"
                    ? `${parameterName} must be true or false`
                    : specification.kind === "text"
                      ? `${parameterName} must be text`
                      : `${parameterName} must be a 0-100 position`,
              });
            }
          }
        }
      });
    });
  });

export const generateToneRequestSchema = z
  .object({
    prompt: trimmedString(1, 1_000),
    target: z.enum(TONE_GENERATION_TARGETS).default("quad-cortex"),
    owned_plugins: z
      .array(z.enum(TONE_PLUGIN_LICENSES))
      .max(TONE_PLUGIN_LICENSES.length)
      .default([]),
  })
  .strict();

export function parseTonePreset(value: unknown): TonePreset {
  return tonePresetSchema.parse(value);
}

export function getTonePresetJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(tonePresetSchema, {
    target: "draft-7",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
