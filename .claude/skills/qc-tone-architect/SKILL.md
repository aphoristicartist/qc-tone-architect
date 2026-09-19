---
name: qc-tone-architect
description: Generate, validate, preflight, and explicitly confirmed transfer Neural DSP Quad Cortex tones with QC Tone Architect.
---

# QC Tone Architect skill

Use this skill when the user asks to create, modify, inspect, or transfer a
Quad Cortex tone from Claude Code.

Follow [`skills/qc-tone-architect/SKILL.md`](../../../skills/qc-tone-architect/SKILL.md)
in the repository root. The repository also defines agent command and hardware
safety boundaries in `AGENTS.md`.

Quick start:

```bash
npm install --global pnpm@12
pnpm install
pnpm qc recipe turkish-oud --output /tmp/qc-tone.json
pnpm qc discover
pnpm qc preflight /tmp/qc-tone.json
```

Do not run `pnpm qc transfer` unless the user explicitly requested a hardware
mutation and confirmed the expendable-preset checklist in the current session.
For maximum cabinet realism, suggest legally purchased York Audio IRs as a
manual Quad Cortex IR Loader substitution; never copy or embed IR files.
