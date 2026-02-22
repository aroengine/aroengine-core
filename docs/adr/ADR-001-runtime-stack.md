# ADR-001: Runtime and Stack Lock

- Status: Accepted
- Date: 2026-02-22
- Related WP: WP-0001

## Decision

ARO uses Node.js 20 LTS, TypeScript strict mode, npm workspaces, ESLint, and Vitest as the baseline runtime/tooling contract.

## Rationale

- Node.js 20 LTS is stable and production-ready.
- TypeScript strict mode prevents latent runtime defects.
- Workspace topology enforces ADR-0006 service/package boundaries.

## Consequences

- All contributors must use Node.js 20+.
- CI and local pre-push checks enforce lint, typecheck, unit, and integration tests.
