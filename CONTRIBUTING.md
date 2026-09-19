# Contributing

Thanks for helping make QC Tone Architect safer and more useful. Small,
well-tested pull requests are easiest to review.

## Before you start

- Search existing issues and open one before a large protocol or architecture
  change.
- Never include API keys, Codex credentials, device serials, personal paths,
  raw user presets, paid impulse responses, captures, plugin binaries, or other
  proprietary material.
- Treat all USB writes as safety-sensitive. A feature that can mutate hardware
  must fail closed on unknown firmware and must not silently broaden its target.

## Development setup

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Before opening a pull request, install Playwright's browsers and run:

```bash
npx playwright install chromium firefox webkit
npm run verify
npm run audit
```

Tests must not require provider credits or connected hardware. Use the local
fake provider and protocol fakes for normal CI coverage.

## Device and control profiles

A new generatable profile must include:

1. A model ID confirmed against a live ModelRepo from the stated firmware.
2. Exact, unambiguous writable control names and correct parameter types.
3. Conservative defaults/ranges and schema tests.
4. A transfer-resolution test proving the mapping is unique.
5. Evidence that the contributor is allowed to share the metadata.

Do not make IR Loader generatable or embed a custom `IR_PATH` in a public recipe.
Do not imply that a plugin model is available without the user's own license.

## Protocol and firmware changes

Keep read-only discovery separate from mutation. New firmware support requires
captured framing tests, typed message tests, timeout/correlation coverage,
preflight behavior, verified read-back, rollback, and an opt-in HIL run on an
expendable preset. Add the exact CorOS/app-firmware pair to the write allowlist
only after that process succeeds.

Fixtures must be minimal and synthetic or thoroughly sanitized. Raw captures
belong in the ignored `captures/` directory and should not be attached publicly
if they contain personal, licensed, or proprietary data.

## Pull requests

- Explain the user-visible change and its safety impact.
- Add or update tests and documentation.
- Keep unrelated formatting or dependency churn out of the change.
- Confirm `npm run verify` and `npm run audit` pass.
- Call out whether real hardware was used and the exact firmware, without
  publishing its serial number.

By contributing, you agree that your contribution is licensed under this
repository's MIT License.
