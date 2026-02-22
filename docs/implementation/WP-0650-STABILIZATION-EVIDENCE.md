# WP-0650 Stabilization Evidence

Date: 2026-02-22

## Scope
- Validate repeatability and stability after Core↔Executor authority contract hardening.
- Capture flaky-test evidence and current residual blockers.

## Repeatability Evidence (Integration Suite)
Command sequence executed:

```bash
for i in 1 2 3 4 5; do
  npm run test:integration
 done
```

Result:
- Run 1: PASS
- Run 2: PASS
- Run 3: PASS
- Run 4: PASS
- Run 5: PASS
- Aggregate: 5/5 passes, no flaky failures observed.

## Contract Stability Evidence
- Dedicated Core contract test added and passing:
  - `apps/core-engine/src/__tests__/integration/core-openclaw-authority.contract.test.ts`
- Assertion proved:
  - Integration side effects dispatch only through `/v1/commands` core path.
  - Bypass attempts (`POST /v1/executions` against core) do not dispatch side effects.
  - Non-integration commands do not dispatch executor side effects.

## Local CI Stability Gate
Command:

```bash
npm run ci:local
```

Result:
- PASS (lint, typecheck, unit tests, integration tests).

## Residual Stabilization Gap
- Staging environment pass evidence/signoff is pending (environment/governance dependent).
- No code-level blocker remains for local stabilization and contract safety.
