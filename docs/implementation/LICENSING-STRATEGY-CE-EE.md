# Licensing Strategy: CE/EE Open-Core

## Goal

Support dual distribution:

- Public CE repository on GitHub.
- Private EE repository/modules for moat features.

## Recommended Model

- CE code: Apache-2.0 (or MIT) in the public repository.
- EE code: Proprietary commercial license in private repository.

## Scope Mapping

- CE scope follows `docs/adr/ADR-006-open-core-ce-ee-distribution.md` and `docs/implementation/PUBLIC-CE-MANIFEST.txt`.
- EE scope includes profile-specific and moat logic and is never exported by CE automation.

## Operational Rules

1. Run `npm run ce:check` before public release.
2. Build public snapshot using `npm run ce:export`.
3. Publish only the exported CE tree from `public-export/ce`.
4. Keep EE source and secrets out of public remotes.

## Legal Handshake

Before first external CE release, finalize legal text and add:

- root `LICENSE` for CE repository,
- `NOTICE` if required,
- private EE commercial terms in private distribution channel.