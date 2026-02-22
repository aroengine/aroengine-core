# Contributing to ARO

## Required Before Every Push

Run the local CI gate:

```bash
npm run lint && npm run typecheck && npm run test && npm run test:integration
```

Or use:

```bash
npm run ci:local
```

## Install Git Hooks

```bash
./scripts/install-git-hooks.sh
```

This configures the repository pre-push hook to block pushes when local CI fails.

## Runtime Baseline

- Node.js 20 LTS+
- npm workspaces
- TypeScript strict mode

## Architecture Boundaries

Follow ADR-0006 service boundaries:

- `apps/core-engine`
- `apps/profile-backend-healthcare`
- `apps/profile-ui-healthcare`
- `apps/openclaw-executor`

Do not implement profile-specific business logic in core-engine.

## Open-Core CE/EE Boundaries

ARO is maintained as open-core:

- CE (public-safe) includes core orchestration and deterministic shared foundations.
- EE (private/moat) includes profile-specific commercial policy and proprietary modules.

Authoritative policy is in `docs/adr/ADR-006-open-core-ce-ee-distribution.md`.

Before preparing any public GitHub sync:

```bash
npm run ce:check
npm run ce:export
```

Only export artifacts generated from `docs/implementation/PUBLIC-CE-MANIFEST.txt`.

## License

- Community Edition (CE) is licensed under Apache-2.0: see `LICENSE`.
- Attribution and distribution notice: see `NOTICE`.
- Enterprise Edition (EE) modules remain proprietary and are distributed separately.

Before publishing CE snapshots, use:

```bash
npm run ce:check
npm run ce:export
```
