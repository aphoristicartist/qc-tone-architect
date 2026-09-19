#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

function loadLocalEnvironment(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    const value = /^(['"])(.*)\1$/su.exec(rawValue)?.[2] ?? rawValue;
    process.env[name] ??= value;
  }
}

loadLocalEnvironment(".env.local");
loadLocalEnvironment(".env");

const require = createRequire(import.meta.url);
const { register } = require("tsx/cjs/api");

register();
require("../src/cli/qc-tone.ts");
