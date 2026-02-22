# Phase 8 Production Gate Evidence

## Regression Gate
- Local CI Gate command: `npm run ci:local`
- Includes lint, typecheck, unit tests, and integration tests.
- Latest evidence (2026-02-22): pass with 55 unit tests and 12 integration tests.

## Coverage Gate
- Coverage command: `npm run test:coverage`
- Global threshold: lines/statements >= 90%
- Latest evidence (2026-02-22): 90.08% lines and 90.08% statements.

## Performance Targets
- Webhook processing target: P95 <= 2000ms.
- Message send target: P95 <= 5000ms.
- Evaluation helper available in shared production gate utility.
- Required load harness command: `npm run perf:k6`
- Harness script: `perf/k6/core-openclaw-smoke.js`
- Summary artifact path: `artifacts/perf/k6-summary.json`
- Current status (2026-02-22): PASS. `k6` installed (`k6 v1.6.1`) and harness executed successfully with thresholds met (`http_req_failed rate=0.00%`, `http_req_duration p(95)=1.43s`).

## Security Targets
- Webhook signature verification required.
- Secrets encrypted at rest required.
- Admin auth and inbound rate limiting required.

## Incident Readiness
- P0 runbook and P1 runbook validation required before GO.

## Staging Signoff and Governance
- Staging signoff artifact: `docs/implementation/STAGING-GOVERNANCE-SIGNOFF-2026-02-22.md`
- Flow conformance artifact: `docs/implementation/FLOW-CONFORMANCE-MATRIX.md`
- Feature-by-feature implementation evidence: `docs/implementation/FEATURE-IMPLEMENTATION-CHECKLIST-2026-02-22.md`

## Rollout Approvals
- Rollout approval artifact: `docs/implementation/ROLLOUT-APPROVALS-2026-02-22.md`
- Artifact state: GO-READY evidence package complete, pending required human signatures.

## GO/NO-GO Decision Contract
- Use `evaluateProductionGate` from shared ops module.
- Decision is `GO` only when all quality, performance, security, and incident checks are green.
