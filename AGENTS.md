<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## QC Tone Architect agent workflow

- This repository uses pnpm. Install it with `npm install --global pnpm@12`,
  then run `pnpm install`.
- The local CLI is `pnpm qc`. Run `pnpm qc help` before improvising commands.
- Generate or load a tone, validate it through the schema/CLI, and run
  `pnpm qc discover` before claiming hardware readiness.
- Never run `pnpm qc transfer ...` unless the user has explicitly requested a
  hardware mutation in the current conversation and has confirmed the safety
  checklist. Always run preflight first and use the exact CLI confirmation flag.
- Keep provider credentials, device serial numbers, raw captures, commercial IRs,
  and user presets out of logs, source, examples, and pull requests.

Useful commands:

```bash
pnpm qc recipe turkish-oud --output /tmp/turkish-oud.json
pnpm qc discover
pnpm qc preflight /tmp/turkish-oud.json
pnpm qc transfer /tmp/turkish-oud.json --confirmation APPLY_TO_EMPTY_PRESET
```
