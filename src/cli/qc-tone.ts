import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { discoverDevices } from "../lib/qc-protocol/qc-connection";
import {
  preflightToneForConnectedQC,
  transferToneToConnectedQC,
} from "../lib/qc-transfer-service";
import { TURKISH_OUD_TONE } from "../lib/recipe-tones";
import { generateTone } from "../lib/tone-generation";
import { parseTonePreset } from "../lib/tone-schema";
import type { ToneGenerationTarget, TonePluginLicense, TonePreset } from "../lib/types";

const CONFIRMATION_PHRASE = "APPLY_TO_EMPTY_PRESET";

const help = `QC Tone Architect CLI

Usage:
  pnpm qc discover
  pnpm qc recipe turkish-oud [--output tone.json]
  pnpm qc generate --prompt "..." [--target quad-cortex|final-cut-camera] [--rabea] [--output tone.json]
  pnpm qc preflight tone.json
  pnpm qc transfer tone.json --confirmation ${CONFIRMATION_PHRASE}

Safety:
  Discovery and preflight are read-only. Transfer is a hardware mutation:
  save your work, load an expendable preset with the target cells empty,
  close Cortex Control, and keep the Quad Cortex connected until verification
  finishes.
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function emit(value: unknown, outputPath?: string): Promise<void> {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(json);
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json, "utf8");
  process.stdout.write(
    JSON.stringify({ ok: true, output: outputPath }) + "\n",
  );
}

async function readTone(path: string): Promise<TonePreset> {
  try {
    return parseTonePreset(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    return fail(
      `Could not load a valid tone from ${path}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      confirmation: { type: "string" },
      help: { type: "boolean" },
      output: { type: "string" },
      prompt: { type: "string" },
      rabea: { type: "boolean" },
      target: { type: "string" },
    },
    allowPositionals: true,
  });

  const command = positionals[0];
  if (!command || command === "help" || values.help) {
    process.stdout.write(help);
    return;
  }

  if (command === "discover") {
    try {
      const devices = discoverDevices();
      await emit({
        connected: devices.length > 0,
        count: devices.length,
        devices: devices.map((device) => ({
          vendorId: `0x${device.vendorId.toString(16)}`,
          productId: `0x${device.productId.toString(16)}`,
          manufacturer: device.manufacturer,
          product: device.product,
        })),
      }, values.output);
      return;
    } catch (error) {
      return fail(
        `Quad Cortex discovery failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  if (command === "recipe") {
    const recipe = positionals[1];
    if (recipe !== "turkish-oud") {
      fail("Available recipes: turkish-oud");
    }
    await emit(TURKISH_OUD_TONE, values.output);
    return;
  }

  if (command === "generate") {
    const prompt = values.prompt?.trim() ?? positionals.slice(1).join(" ").trim();
    if (!prompt) fail("A --prompt value is required");
    if (prompt.length > 1_000) fail("The prompt must be 1000 characters or less");

    const target = (values.target ?? "quad-cortex") as ToneGenerationTarget;
    if (target !== "quad-cortex" && target !== "final-cut-camera") {
      fail("Target must be quad-cortex or final-cut-camera");
    }
    const ownedPlugins: TonePluginLicense[] = values.rabea
      ? ["archetype-rabea-x"]
      : [];
    const tone = await generateTone(prompt, undefined, target, ownedPlugins);
    await emit(tone, values.output);
    return;
  }

  if (command === "preflight") {
    const input = positionals[1];
    if (!input) fail("A tone JSON path is required");
    const tone = await readTone(input);
    await emit(await preflightToneForConnectedQC(tone), values.output);
    return;
  }

  if (command === "transfer") {
    const input = positionals[1];
    if (!input) fail("A tone JSON path is required");
    if (values.confirmation !== CONFIRMATION_PHRASE) {
      fail(`Transfer requires --confirmation ${CONFIRMATION_PHRASE}`);
    }
    const tone = await readTone(input);
    await emit(await transferToneToConnectedQC(tone), values.output);
    return;
  }

  fail(`Unknown command: ${command}\n\n${help}`);
}

main().catch((error: unknown) => {
  if (process.exitCode !== 1) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unexpected CLI failure"}\n`,
    );
    process.exitCode = 1;
  }
});
