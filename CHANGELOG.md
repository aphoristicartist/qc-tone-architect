# Changelog

Notable changes will be documented here. This project follows Semantic
Versioning once public releases begin.

## Unreleased

### Added

- Local Codex and optional OpenAI-compatible tone generation.
- General Quad Cortex sound design by default, with the iPhone / Final Cut
  Camera profile available as an explicit target.
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
