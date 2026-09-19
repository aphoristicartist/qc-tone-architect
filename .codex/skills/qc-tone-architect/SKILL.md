---
name: qc-tone-architect
description: Generate, validate, preflight, and explicitly confirmed transfer Neural DSP Quad Cortex tones with QC Tone Architect.
---

# QC Tone Architect skill

Use this skill when the user asks to create, modify, inspect, or transfer a
Quad Cortex tone from Codex.

Follow [`skills/qc-tone-architect/SKILL.md`](../../../skills/qc-tone-architect/SKILL.md)
in the repository root. Project-specific agent rules are in `AGENTS.md`.

Install the portable copy into Codex's user skill directory if Codex does not
automatically discover repository skills:

```bash
mkdir -p ~/.codex/skills
cp -R skills/qc-tone-architect ~/.codex/skills/
```

Then ask Codex: “Use the qc-tone-architect skill to create and preflight a
Quad Cortex tone.”

Commercial IRs such as York Audio are user-owned local assets. Suggest them as
a manual IR Loader substitution only; never copy or embed IR files or paths.
