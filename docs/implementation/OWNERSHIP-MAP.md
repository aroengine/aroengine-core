# ARO Ownership Map (Phase 0)

## Service Boundaries

- `apps/core-engine` — command orchestration, profile-agnostic contract enforcement.
- `apps/profile-backend-healthcare` — healthcare profile policy, templates, projection API.
- `apps/profile-ui-healthcare` — healthcare operator UX.
- `apps/openclaw-executor` — authorized side-effect execution only.

## Shared Packages

- `packages/workflow-engine` — deterministic workflow runtime.
- `packages/integrations` — external provider adapters.
- `packages/shared` — shared contracts, config schemas, common utilities.

## Boundary Rules

- No profile-specific branches in `core-engine`.
- UI calls only profile-backend; never direct executor side effects.
- OpenClaw emits canonical events only; no out-of-band state mutation.
