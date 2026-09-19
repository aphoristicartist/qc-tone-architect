# QC Tone Architect

QC Tone Architect is a local-first, open-source tone designer for Neural DSP
Quad Cortex. Describe a sound in plain language, validate the resulting signal
chain against a curated hardware model catalog, then export it as JSON or apply
it to an empty area of the Quad Cortex's current grid.

This is an independent community project. It is not affiliated with, sponsored
by, or endorsed by Neural DSP. Quad Cortex, Cortex Control, CorOS, and Neural DSP
are trademarks of their respective owner.

[![CI](https://github.com/aphoristicartist/qc-tone-architect/actions/workflows/ci.yml/badge.svg)](https://github.com/aphoristicartist/qc-tone-architect/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> [!CAUTION]
> Direct USB transfer uses a reverse-engineered, firmware-specific protocol.
> Save your work, load an expendable preset with the requested cells empty,
> close Cortex Control, and do not disconnect the unit during a transfer.

## What it does

- Generates amps, cabs, effects, parameters, four performance scenes, and
  practical setup notes from a natural-language prompt.
- Uses a strict schema and a curated list of writable model IDs and controls;
  model output cannot invent arbitrary hardware commands.
- Includes portable factory-only Modern Jazz, Modern Fusion, and Modern Ambient
  starter recipes for direct iPhone / Final Cut Camera recording.
- Keeps licensed Archetype: Rabea X blocks out of generation unless the user
  explicitly confirms that the connected unit has a valid license.
- Runs read-only hardware preflight before confirmation, repeats it immediately
  before writing, and refuses occupied target cells.
- Verifies every mutation from the unit and rolls back inserted blocks and scene
  changes after a failed transaction.
- Stores generated history only in browser local storage and supports JSON
  export.

It is a creative starting point, not a promise to reproduce literally every
sound or every Quad Cortex model. Results depend on the guitar, pickups, playing,
firmware, licensed plugins, monitoring, and gain staging.

## Compatibility

| Capability | Status |
| --- | --- |
| Tone generation, validation, history, and JSON export | Supported |
| Passive Quad Cortex USB discovery | Supported |
| CorOS 4.0.1 / app firmware `d14e` direct transfer | Hardware verified |
| CorOS 4.1.0 / app firmware `d14e` direct transfer | Hardware verified |
| CorOS 4.1.1 direct transfer | Blocked pending hardware-in-the-loop verification |
| Any other CorOS/app-firmware pair | Write blocked by design |

Hardware transfer has been verified on macOS. The automated suite also runs on
Linux without hardware; Windows and Linux HID transfer need community hardware
verification. Firmware updates can change the private protocol, so unknown
versions fail closed until they are deliberately tested and allowlisted.

Only models with known IDs and typed control profiles are offered to the model.
At transfer time, every selected model and control is resolved again against the
connected unit's live ModelRepo. Plugin blocks require the corresponding valid,
unlocked Neural DSP plugin on that unit. No plugin binaries, captures,
commercial impulse responses, or Neural DSP assets are included.

The bundled starter recipes use free Virtual Devices introduced in CorOS 4.1.0,
so those recipes require CorOS 4.1.0 or newer for manual recreation. Direct USB
transfer remains gated to the exact firmware pairs in the table above. Neural
DSP's [CorOS 4.1.0 notes](https://neuraldsp.com/quad-cortex-updates/coros-and-cortex-control-4-1-0-are-now-available)
identify those devices as available to all Quad Cortex users.

Custom-IR paths are local to one Quad Cortex and are not portable between users.
The bundled recipes therefore use factory cabs only.

## Requirements

- Node.js 20 or newer and npm.
- A ChatGPT/Codex login (default) or an OpenAI-compatible API credential.
- For hardware features: a Quad Cortex connected by USB to the same computer.

## Quick start

From this directory:

```bash
npm ci
cp .env.example .env.local
npx codex login
npm run dev
```

On Windows PowerShell, replace the copy command with:

```powershell
Copy-Item .env.example .env.local
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Both development and
production scripts bind only to loopback by default because the server can use
local credentials and access USB hardware. Exposing this application to a LAN or
the public internet is unsupported.

The default `.env.local` configuration is:

```dotenv
TONE_PROVIDER=codex
CODEX_MODEL=
CODEX_REASONING_EFFORT=medium
CODEX_TIMEOUT_MS=120000
```

The app uses the bundled Codex CLI and the ChatGPT login belonging to the OS user
running the server. `CODEX_MODEL` is optional. Check authentication with
`npx codex login status`; running `npx codex` also starts the first-run sign-in
flow. See the official [Codex CLI guide](https://developers.openai.com/codex/cli)
and [authentication guide](https://developers.openai.com/codex/auth).

Licensed Rabea X models are disabled by default. Enable the visible
**Include Archetype: Rabea X devices** checkbox only when that plugin is licensed
and unlocked on the destination unit. The server filters the generation catalog
and rejects unlicensed plugin output even if a provider returns it anyway.

Each generation uses a fresh temporary workspace and ephemeral Codex session.
Shell tools, project files and instructions, web access, hooks, session history,
and multi-agent work are disabled. Only a small environment allowlist and the
Codex authentication location reach the child process.

### Optional OpenAI-compatible provider

Set these values only when you intentionally use another provider:

```dotenv
TONE_PROVIDER=openai-compatible
GLM_API_KEY=your-key
GLM_BASE_URL=https://provider.example/v1/
GLM_MODEL=provider-model
GLM_TIMEOUT_MS=45000
GLM_RESPONSE_FORMAT=json_object
```

Use `json_schema` only if that provider and model document support it. Runtime
schema validation still runs for either response mode. Environment files are
ignored by Git; `.env.example` contains placeholders only.

## Safe hardware workflow

1. Save the current preset on the Quad Cortex.
2. Load an expendable preset and make sure the cells requested by the generated
   tone are empty.
3. Close Cortex Control; HID access can be exclusive.
4. Connect the QC directly over USB and check the device/firmware status in the
   app.
5. Run preflight, review the exact blocks and cells, then type the confirmation
   phrase shown by the app.
6. Wait for verified success before touching or unplugging the unit.
7. Audition the live grid and save it from the Quad Cortex if you want to keep
   it. The app intentionally does not overwrite a stored preset slot.

The transfer path is sparse: it inserts only requested blocks and scene data. If
verification fails, it removes what it inserted and verifies restoration. If the
app reports that rollback could not be verified, inspect the preset on the unit
before doing anything else.

## Direct iPhone recording

The included starter tones target a single Row 1 path with Clean, Wide, Lead,
and Ambient scenes, conservative wet mixes, and scene-level compensation.

1. On the QC, route the processed stereo signal to USB 1/2.
2. In Final Cut Camera, open **Settings → Audio**, choose **Quad Cortex**, and
   select **Stereo**.
3. Monitor from the QC headphone output, not Bluetooth headphones.
4. Play the loudest scene and set the QC USB level so camera peaks stay around
   -12 to -6 dBFS without clipping.

The app cannot inspect the iPhone's meter or the QC's physical USB routing, so
confirm those two settings for every recording session.

## Development

```bash
npm run dev          # Local development server on 127.0.0.1
npm run build        # Optimized production build
npm run start        # Run the production build on 127.0.0.1
npm run lint         # ESLint
npm run typecheck    # TypeScript, including tests and scripts
npm test             # Unit and route tests
npm run test:e2e     # Build plus four Playwright browser projects
npm run audit        # Dependency vulnerability audit
npm run verify       # Complete local release gate except the online audit
```

Install browser binaries once before the first E2E run:

```bash
npx playwright install chromium firefox webkit
```

The E2E suite uses a deterministic local provider and simulated hardware. It
does not spend model usage or write to a Quad Cortex.

### Protocol research tool

`npm run qc:capture` passively records HID traffic for controlled development;
it does not send reports to the unit. Captures stay under ignored `captures/`.
They may contain device-specific or copyrighted data, so sanitize them and
obtain permission before sharing any fixture.

The mutation hardware-in-the-loop test is skipped unless an exact serial and a
deliberate confirmation are both supplied. Close Cortex Control, save your work,
and load an expendable preset with cells 1.1 through 1.4 empty first:

```bash
QC_HIL_SERIAL='your-device-serial' \
QC_HIL_TRANSFER_CONFIRM='MUTATE_AND_RESTORE_EMPTY_QC_PRESET' \
npx vitest run src/lib/qc-protocol/hardware-transfer.hil.test.ts
```

## Architecture

- `src/app/api/generate-tone` — same-origin, size-limited, rate-limited provider
  boundary with sanitized errors.
- `src/lib/tone-schema.ts` — runtime contract and cross-field invariants.
- `src/lib/devices.ts` — curated generation profiles and hardware mappings.
- `src/lib/codex-tone-generation.ts` — isolated local Codex execution.
- `src/lib/glm.ts` — optional OpenAI-compatible client.
- `src/app/api/qc-transfer` — preflight and confirmed transaction endpoints.
- `src/lib/qc-protocol` — HID framing, typed sessions, live catalog parsing,
  request correlation, read-back verification, and rollback.
- `src/lib/camera-ready-presets.ts` — portable factory-only starter recipes.
- `src/lib/tone-history.ts` — versioned browser-local persistence.

## Security and privacy

- Prompts go only to the configured provider. Authentication stays server-side.
- All sensitive POST endpoints require same-origin JSON and bounded request
  bodies; responses use `Cache-Control: no-store`.
- The app binds to loopback by default and is not designed as a multi-user or
  internet-facing service.
- Browser history remains in local storage unless the user exports it.
- USB paths and raw upstream/provider diagnostics are not returned to the UI.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and
[CONTRIBUTING.md](CONTRIBUTING.md) before submitting hardware mappings or
protocol changes. Usage and support expectations are in
[SUPPORT.md](SUPPORT.md). Protocol details and known limitations are documented
in [src/lib/qc-protocol/README.md](src/lib/qc-protocol/README.md).

## License

The project source is available under the [MIT License](LICENSE). That license
does not grant rights to third-party trademarks, commercial plugins, captures,
impulse responses, or other proprietary content.
