---
name: qc-tone-architect
description: Generate, validate, preflight, and explicitly confirmed transfer Neural DSP Quad Cortex tones with QC Tone Architect.
---

# QC Tone Architect skill

Use this skill when the user asks to create, modify, inspect, or transfer a
Quad Cortex tone, especially from Claude Code, Codex, or another coding agent.

## Required workflow

1. Work from a clone of `aphoristicartist/qc-tone-architect`.
2. Use pnpm:

   ```bash
   npm install --global pnpm@12
   pnpm install
   ```

   The CLI reads `.env.local` and `.env`; shell environment variables take
   precedence.

3. Generate or select a transfer-safe tone:

   ```bash
   pnpm qc generate --prompt "warm Turkish-oud-inspired clean tone" \
     --target quad-cortex --output /tmp/qc-tone.json
   ```

   For the built-in example:

   ```bash
   pnpm qc recipe turkish-oud --output /tmp/qc-tone.json
   ```

4. Check hardware before making claims about readiness:

   ```bash
   pnpm qc discover
   ```

5. Run read-only preflight:

   ```bash
   pnpm qc preflight /tmp/qc-tone.json
   ```

6. Only after the user explicitly asks to write to the Quad Cortex, confirm that
   they have saved their work, loaded an expendable preset with the requested
   cells empty, and closed Cortex Control. Then run:

   ```bash
   pnpm qc transfer /tmp/qc-tone.json \
     --confirmation APPLY_TO_EMPTY_PRESET
   ```

## Boundaries

- Never run transfer automatically as part of development, tests, or an ordinary
  tone-generation request.
- Do not hide or reinterpret a failed preflight.
- Do not put API keys, device serials, captures, user presets, proprietary
  plugins, or commercial IRs in source or chat logs.
- York Audio IRs can materially improve cabinet realism. Recommend them only as
  a legally purchased, user-installed option; do not copy IR files, embed IR
  paths, or attempt to transfer an IR selection that is local to one unit.
- If discovery reports `connected: false`, ask the user to connect the Quad
  Cortex by USB and close Cortex Control; do not speculate that a transfer is
  ready.
