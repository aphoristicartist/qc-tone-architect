# Security Policy

## Supported versions

Security fixes are applied to the latest code on the default branch. Until the
first tagged release, `main` is the only supported version.

## Reporting a vulnerability

Please use this repository's private **Report a vulnerability** / GitHub
Security Advisory flow. Do not open a public issue for an unpatched
vulnerability. Include affected versions, reproduction steps, impact, and a
minimal proof of concept. Remove API keys, authentication files, device serials,
raw captures, presets, and commercial IR data before submitting.

If private reporting has not been enabled by the repository owner, open a public
issue containing no exploit details and ask the maintainer to enable a private
reporting channel.

## Local security boundary

QC Tone Architect is intended for a trusted, single-user computer and binds to
`127.0.0.1` by default. It is not hardened as a public or shared network service.
Anyone who can use the local browser session may be able to spend configured
provider quota or initiate the explicit USB transfer flow.

Direct transfer is limited to exact verified firmware pairs, empty target cells,
explicit user confirmation, and read-back-verified transactions with rollback.
Nevertheless, save important work and use an expendable preset. If restoration
cannot be verified, stop and inspect the Quad Cortex directly.

The application is unofficial and uses a reverse-engineered protocol that may
change without notice. Unknown firmware is write-blocked by design.
