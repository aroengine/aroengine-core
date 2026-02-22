# ADR-006: Open-Core CE/EE Distribution Model

- Status: Accepted
- Date: 2026-02-22
- Related WP: Governance extension

## Decision

ARO uses an open-core split with strict repository boundaries:

- Community Edition (CE, public GitHub-safe):
  - `apps/core-engine`
  - `apps/openclaw-executor`
  - `packages/shared`
  - `packages/workflow-engine`
  - public-safe docs (`docs/specs`, selected ADRs)
  - baseline scripts and quality tooling

- Enterprise Edition (EE, private moat):
  - `apps/profile-backend-healthcare`
  - `apps/profile-ui-healthcare`
  - `packages/integrations`
  - implementation/internal operating docs and moat-specific logic

The core orchestration engine remains CE and is never moved to private scope.

## Boundary Rules

1. CE code must not import EE modules.
2. Moat features (vertical policy packs, commercial logic, proprietary optimizations) stay EE-only.
3. Public export uses allowlist-based sync only.
4. Any CE/EE scope change requires ADR update and review.

## Enforcement

- `scripts/check-ce-boundaries.sh` validates CE import boundaries.
- `scripts/export-public-ce.sh` exports only CE allowlisted files into `public-export/ce`.
- `npm run ce:check` and `npm run ce:export` provide repeatable operational commands.

## Rationale

This preserves the strategic moat in private EE while enabling a high-trust public CE repository centered on `core-engine` and deterministic platform primitives.