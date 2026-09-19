# Changelog

Notable changes will be documented here. This project follows Semantic
Versioning once public releases begin.

## Unreleased

### Added

- Local Codex and optional OpenAI-compatible tone generation.
- General Quad Cortex sound design by default, with the iPhone / Final Cut
  Camera profile available as an explicit target.
- A `qc-tone` CLI for discovery, generation, built-in recipes, read-only
  preflight, and explicitly confirmed transfer.
- Claude Code and Codex skill integration with agent safety boundaries.
- A factory-device Turkish oud-inspired example tone.
- Strict model-output validation and a curated Quad Cortex model catalog.
- Explicit, server-enforced opt-in for licensed Archetype: Rabea X devices.
- Portable Modern Jazz, Modern Fusion, and Modern Ambient starter recipes.
- Local USB discovery and transactional live-grid transfer.
- CorOS 4.0.1 / `d14e` and CorOS 4.1.0 / `d14e` hardware compatibility gates.
- Unit, route, production-build, accessibility, and cross-browser E2E tests.

### Security

- Loopback-only server defaults, same-origin bounded POST endpoints, sanitized
  errors, no-store responses, rate limiting, explicit transfer confirmation,
  firmware gating, read-back verification, and rollback.

### Changed

- Migrated the supported package manager and CI cache from npm to pnpm 12.
- Updated the bundled Codex CLI, OpenAI SDK, React, Node HID bindings, test
  stack, and lint stack to their current compatible versions.
