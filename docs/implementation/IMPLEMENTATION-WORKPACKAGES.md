# ARO — Implementation Work Packages (All Phases)

**Product:** Appointment Revenue Optimizer (ARO)  
**Version:** 1.0  
**Last Updated:** 2026-02-22  
**Companion Doc:** `docs/implementation/IMPLEMENTATION-PLAN.md`

---

## 1. Purpose

This document operationalizes every phase in `docs/implementation/IMPLEMENTATION-PLAN.md` into concrete work packages that can be executed by:
- human engineers,
- AI coding agents,
- mixed teams.

Each work package includes objective, scope, dependencies, deliverables, tests, and exit criteria.

### 1.1 Core + Profile Packaging Policy

- Work packages implement **Core Platform** capabilities first (domain-agnostic).
- Phase 1 profile-specific scope is `healthcare` (default profile).
- Future profiles (salon, legal consults, coaching, etc.) are additive overlays and must not break Core contracts.

### 1.2 ADR-0006 Contract Enforcement

- `docs/implementation/ADR-0006-core-engine-service-boundaries.md` is the mandatory service-boundary baseline.
- Work packages must preserve separation of:
	- `core-engine` (independent stateless service),
	- `profile-backend` (profile policy + projection layer),
	- `profile-ui` (presentation layer),
	- `openclaw-executor` (core-authorized side-effect runner).
- Any change to Command API/Event API/Profile Pack interface requires explicit contract test updates.
- Any change to Core↔OpenClaw execution contract requires contract and replay/idempotency test updates.
- ADR-0006 boundaries/contracts are treated as production v1 baseline and remain unchanged unless new features/profile capabilities are added.
- Non-additive boundary/contract changes require ADR update + GO/NO-GO gate approval evidence.

---

## 2. Mandatory Execution Rule (Global)

## Local CI Gate Before Every Push (Required)

Every contributor and AI coding agent must run the Local CI Gate before pushing to any remote branch.

Required command:

```bash
npm run lint && npm run typecheck && npm run test && npm run test:integration
```

Enforcement requirements:
- Push is blocked if the Local CI Gate fails.
- Re-run gate after pull/rebase from main.
- No bypass for urgent/minor changes.
- Remote CI is still required.

Recommended implementation:
- Git `pre-push` hook runs the Local CI Gate.
- Branch protection requires remote CI checks to pass.

Setup commands (run once per clone):

```bash
git init   # only if repo is not initialized yet
./scripts/install-git-hooks.sh
```

---

## 3. Work Package Template

```md
### WP-<ID>: <Title>
Phase:
Priority:
Objective:
Depends On:
Inputs (Specs):
Implementation Scope:
Out of Scope:
Deliverables:
Tests:
Definition of Done:
Risks:
Rollback:
```

---

## 4. Phase 0 Work Packages — Program Setup & Architecture Lock

### WP-0001: Runtime and Stack Lock
Phase: 0  
Priority: P0
- Objective: Lock language/runtime/toolchain versions and compatibility.
- Depends On: None
- Inputs (Specs): 01, 05
- Implementation Scope: Node LTS version, TS strict mode, package manager, OpenClaw version contract.
- Deliverables: `docs/adr/ADR-001-runtime-stack.md`, root tooling configs.
- Tests: Version checks in CI, startup smoke.
- Definition of Done: Environment reproducible on macOS/Linux.

### WP-0002: Repository Structure and Boundaries
Phase: 0  
Priority: P0
- Objective: Define module boundaries for API/workflow/integrations/shared.
- Depends On: WP-0001
- Inputs (Specs): 01
- Deliverables: Monorepo folder layout, ownership map.
- Tests: Build graph and import-boundary checks.
- Definition of Done: No cross-boundary violations in static checks.

### WP-0003: Environment and Secret Contract
Phase: 0  
Priority: P0
- Objective: Standardize all env vars and secret handling.
- Depends On: WP-0001
- Inputs (Specs): 05, 07
- Deliverables: `.env.example`, env schema, secret naming standard.
- Tests: Startup validation for missing/invalid env.
- Definition of Done: Service fails fast on invalid config.

### WP-0004: Local + Remote CI Gate Setup
Phase: 0  
Priority: P0
- Objective: Enforce the Local CI Gate before push and remote CI in branch protection.
- Depends On: WP-0001
- Inputs (Specs): 05
- Deliverables: CI workflow, `pre-push` hook script, contributor guide.
- Tests: Intentionally failing code blocks push.
- Definition of Done: Pre-push gate active for all contributors.

### WP-0006: Security Scanning Baseline
Phase: 0  
Priority: P0
- Objective: Enforce dependency and secret scanning before merge.
- Depends On: WP-0004
- Inputs (Specs): 07
- Deliverables: CI jobs for dependency scanning + secret scanning, fail thresholds.
- Tests: seeded vulnerable dependency and fake secret detection test.
- Definition of Done: Security scan failures block merge.

### WP-0007: Staging Environment Contract
Phase: 0  
Priority: P0
- Objective: Define and enforce staging parity rules.
- Depends On: WP-0002, WP-0003
- Inputs (Specs): 05
- Deliverables: staging checklist, promotion gate criteria, synthetic data policy.
- Tests: staging smoke verification.
- Definition of Done: release cannot promote without staging gate pass.

### WP-0005: Architecture Decision Records Baseline
Phase: 0  
Priority: P1
- Objective: Capture non-negotiable architectural decisions.
- Depends On: WP-0001, WP-0002, WP-0003
- Inputs (Specs): 01
- Deliverables: ADRs for orchestration model, data model approach, integration adapter pattern, and ADR-0006 service boundaries/API contracts.
- Tests: Review signoff checklist.
- Definition of Done: ADR set approved and versioned.

### WP-0008: Core Engine Contract Baseline (Command/Event/Profile)
Phase: 0  
Priority: P0
- Objective: Freeze v1 contract between core-engine and profile backends.
- Depends On: WP-0002, WP-0005
- Inputs (Specs): 01, 03, 04, 07
- Deliverables: command envelope schema, event envelope schema, Profile Pack interface schema, contract test suite.
- Tests: schema validation tests, idempotency header enforcement tests, replay cursor tests.
- Definition of Done: contracts published and verified in CI; profile backend integration passes against v1 contracts.

### WP-0009: Core↔OpenClaw Execution Contract Baseline
Phase: 0  
Priority: P0
- Objective: Freeze v1 execution interface between core-engine and openclaw-executor.
- Depends On: WP-0008
- Inputs (Specs): 01, 03, 04, ADR-0006
- Deliverables: execution command schema, executor result event schema, permission manifest schema, contract test suite.
- Tests: executor idempotency tests, canonical event normalization tests, authorization/permission manifest tests.
- Definition of Done: executor integration passes contract suite with replay-safe event behavior.

---

## 5. Phase 1 Work Packages — Core Platform Foundation

### WP-0101: API Bootstrap and Module Wiring
Phase: 1  
Priority: P0
- Objective: Create production-safe API skeleton.
- Depends On: Phase 0 complete
- Inputs (Specs): 01, 05
- Deliverables: API app, route modules, dependency injection skeleton.
- Tests: Boot test, route registration test.
- Definition of Done: Service starts and serves health endpoints.

### WP-0102: Config Validation Layer
Phase: 1  
Priority: P0
- Objective: Prevent bad runtime config from reaching execution.
- Depends On: WP-0101
- Inputs (Specs): 05, 07
- Deliverables: Typed config loader and validation errors.
- Tests: Positive/negative config tests.
- Definition of Done: Invalid config fails startup deterministically.

### WP-0103: Structured Logging + Correlation
Phase: 1  
Priority: P0
- Objective: Standardize logs for debugging and audit.
- Depends On: WP-0101
- Inputs (Specs): 05, 07
- Deliverables: JSON logger, request IDs, log redaction utility.
- Tests: Log shape snapshots, secret redaction tests.
- Definition of Done: All API paths emit structured logs.

### WP-0104: Health and Readiness Probes
Phase: 1  
Priority: P0
- Objective: Operational visibility for process/db/runtime dependencies.
- Depends On: WP-0101
- Inputs (Specs): 05
- Deliverables: `/health`, `/ready` checks.
- Tests: Probe tests with dependency failure injection.
- Definition of Done: Readiness accurately reports dependency state.

### WP-0105: Migration Pipeline Foundation
Phase: 1  
Priority: P0
- Objective: Safe schema lifecycle control.
- Depends On: WP-0101
- Inputs (Specs): 02
- Deliverables: migration tooling, first baseline migration.
- Tests: migration up/down in CI.
- Definition of Done: Fresh DB and rollback both succeed.

### WP-0106: Error Envelope Standardization
Phase: 1  
Priority: P1
- Objective: Uniform client/server error semantics.
- Depends On: WP-0101
- Inputs (Specs): 04
- Deliverables: canonical error codes and response builder.
- Tests: contract tests across endpoints.
- Definition of Done: All errors mapped to standard envelopes.

---

## 6. Phase 2 Work Packages — Data Layer & Persistence

### WP-0201: Core Schema — Customers and Appointments
Phase: 2  
Priority: P0
- Objective: Implement foundational business entities.
- Depends On: Phase 1 complete
- Inputs (Specs): 02
- Deliverables: tables, enums, constraints, indices.
- Tests: schema integrity tests.
- Definition of Done: CRUD and constraints validated.

### WP-0202: Reminder Logs and Delivery Tracking
Phase: 2  
Priority: P0
- Objective: Persist message delivery lifecycle.
- Depends On: WP-0201
- Inputs (Specs): 02, 04
- Deliverables: reminder logs table and repository.
- Tests: insert/query performance and correctness tests.
- Definition of Done: Reminder audit trail is queryable by appointment/customer.

### WP-0203: Event Store and Immutable Events
Phase: 2  
Priority: P0
- Objective: Build source of truth for audit and workflow triggers.
- Depends On: WP-0201
- Inputs (Specs): 02, 03, 07
- Deliverables: `events` model, append-only write path.
- Tests: immutability and query tests.
- Definition of Done: Events are append-only and indexed for lookup.

### WP-0204: Workflow Instance Persistence
Phase: 2  
Priority: P0
- Objective: Persist orchestration state/retries/errors.
- Depends On: WP-0201
- Inputs (Specs): 02, 03
- Deliverables: workflow instances table + repo.
- Tests: transition and retry persistence tests.
- Definition of Done: Workflow recovery from persisted state works.

### WP-0205: Business Config and Encrypted Integrations
Phase: 2  
Priority: P0
- Objective: Persist business rules and provider credentials securely.
- Depends On: WP-0201
- Inputs (Specs): 02, 07
- Deliverables: single-row business config model, encryption integration.
- Tests: encrypted field round-trip tests.
- Definition of Done: No plaintext secrets at rest.

### WP-0206: Validation and Transition Rule Enforcement
Phase: 2  
Priority: P1
- Objective: Enforce domain correctness at data boundaries.
- Depends On: WP-0201
- Inputs (Specs): 02, 03
- Deliverables: validators (E.164, future date, status transitions).
- Tests: validation matrix tests.
- Definition of Done: Invalid states are rejected before persistence.

### WP-0207: Migration Rollback Templates
Phase: 2  
Priority: P0
- Objective: Guarantee reversible schema operations for every migration.
- Depends On: WP-0105
- Inputs (Specs): 02, implementation plan
- Deliverables: paired `up/down` migration templates and rollback playbook.
- Tests: up->down->up migration cycle in CI.
- Definition of Done: rollback validated for every schema PR.

---

## 7. Phase 3 Work Packages — Workflow Engine

### WP-0301: Appointment State Machine Engine
Phase: 3  
Priority: P0
- Objective: Enforce deterministic appointment transitions.
- Depends On: Phase 2 complete
- Inputs (Specs): 03
- Deliverables: transition engine and guards.
- Tests: full transition matrix tests.
- Definition of Done: Unsupported transitions blocked.

### WP-0302: Workflow Runtime State Machine
Phase: 3  
Priority: P0
- Objective: Execute deterministic workflow lifecycle.
- Depends On: WP-0301
- Inputs (Specs): 03
- Deliverables: runtime state manager.
- Tests: pending/running/waiting/retrying/completed/failed tests.
- Definition of Done: Runtime supports pause/retry/fail correctly.

### WP-0303: Trigger Engine (Event/Time/Pattern)
Phase: 3  
Priority: P0
- Objective: Dispatch actions based on trigger semantics.
- Depends On: WP-0302
- Inputs (Specs): 03
- Deliverables: trigger evaluator and dispatcher.
- Tests: condition/action tests including delayed actions.
- Definition of Done: Trigger execution order and conditions are deterministic.

### WP-0304: Retry and Backoff Executor
Phase: 3  
Priority: P0
- Objective: Handle transient failures safely.
- Depends On: WP-0302
- Inputs (Specs): 03, 04
- Deliverables: retry utility with exponential backoff.
- Tests: retryable/non-retryable behavior tests.
- Definition of Done: Retries capped and observable.

### WP-0305: Dead Letter Queue
Phase: 3  
Priority: P0
- Objective: Capture and recover terminal workflow failures.
- Depends On: WP-0304
- Inputs (Specs): 03
- Deliverables: DLQ persistence + replay/archive commands.
- Tests: DLQ add/retry/archive tests.
- Definition of Done: Failed workflow context is recoverable.

### WP-0306: Guardrails and Escalation
Phase: 3  
Priority: P0
- Objective: Prevent unsafe autonomous actions.
- Depends On: WP-0302
- Inputs (Specs): 03, 07
- Deliverables: guardrails and admin escalation policy.
- Tests: guardrail violation + escalation tests.
- Definition of Done: Auto-cancel/auto-charge prohibited by system rules.

---

## 8. Phase 4 Work Packages — Integrations and Webhooks

### WP-0401: Booking Adapter Interface + Calendly Adapter
Phase: 4  
Priority: P0
- Objective: Ingest and normalize booking events.
- Depends On: Phase 3 complete
- Inputs (Specs): 04
- Deliverables: booking adapter contract + Calendly implementation.
- Tests: adapter contract tests and normalized payload tests.
- Definition of Done: Appointments are created/updated via booking events.

### WP-0402: Messaging Adapter (Twilio SMS First)
Phase: 4  
Priority: P0
- Objective: Reliable outbound/inbound messaging path.
- Depends On: WP-0401
- Inputs (Specs): 04
- Deliverables: send/status/inbound webhook handlers.
- Tests: send, delivery-status, inbound parsing tests.
- Definition of Done: Message lifecycle is fully trackable.

### WP-0403: Payment Adapter (Stripe Payment Links)
Phase: 4  
Priority: P0
- Objective: Support deposit request workflow.
- Depends On: WP-0401
- Inputs (Specs): 04
- Deliverables: payment link creation + webhook handling.
- Tests: link create + payment success webhook tests.
- Definition of Done: Deposit paid status updates are reliable.

### WP-0404: Webhook Verification and Idempotency
Phase: 4  
Priority: P0
- Objective: Eliminate replay/spoof duplication risks.
- Depends On: WP-0401, WP-0402, WP-0403
- Inputs (Specs): 04, 07
- Deliverables: signature verification middleware + idempotency keys.
- Tests: invalid-signature, replay, duplicate-delivery tests.
- Definition of Done: Duplicate webhooks do not create duplicate side effects.

### WP-0405: Internal Admin APIs
Phase: 4  
Priority: P1
- Objective: Expose operational visibility and control.
- Depends On: WP-0404
- Inputs (Specs): 04
- Deliverables: appointments, metrics, manual overrides endpoints.
- Tests: API contract and auth tests.
- Definition of Done: Dashboard backend supports MVP views.

---

## 9. Phase 5 Work Packages — Resilience, Security, Compliance

### WP-0501: Circuit Breakers Per Provider Domain
Phase: 5  
Priority: P0
- Objective: Fail fast and recover safely from provider outages.
- Depends On: Phase 4 complete
- Inputs (Specs): 04
- Deliverables: breaker layer for messaging, booking, payment.
- Tests: closed/open/half-open tests.
- Definition of Done: Provider outage does not cascade system-wide.

### WP-0502: Outbound and Inbound Rate Limiting
Phase: 5  
Priority: P0
- Objective: Protect costs, abuse surfaces, and provider quotas.
- Depends On: WP-0501
- Inputs (Specs): 04, 03
- Deliverables: provider limiters + admin/webhook IP limits + per-customer message caps.
- Tests: throttle and burst tests.
- Definition of Done: Limits enforced with predictable errors.

### WP-0503: Retry with Jitter + Fallback Queueing
Phase: 5  
Priority: P0
- Objective: Improve delivery under transient failures.
- Depends On: WP-0501
- Inputs (Specs): 04, 03
- Deliverables: retry policies and fallback queue flows.
- Tests: transient-failure recovery tests.
- Definition of Done: Fallback path is automatic and observable.

### WP-0504: Admin AuthN/AuthZ Hardening
Phase: 5  
Priority: P0
- Objective: Secure admin surface.
- Depends On: WP-0405
- Inputs (Specs): 07
- Deliverables: JWT/session policy, password policy, optional MFA.
- Tests: auth flow + session security tests.
- Definition of Done: Unauthorized actions are blocked consistently.

### WP-0505: Data Encryption and Secret Protection
Phase: 5  
Priority: P0
- Objective: Protect sensitive data at rest and in transit.
- Depends On: WP-0205
- Inputs (Specs): 07
- Deliverables: field encryption, TLS hardening, secure key derivation.
- Tests: encryption correctness and misuse tests.
- Definition of Done: Sensitive fields never stored plaintext.

### WP-0506: Audit Logging and Compliance Flows
Phase: 5  
Priority: P0
- Objective: Compliance-grade traceability.
- Depends On: WP-0203
- Inputs (Specs): 07
- Deliverables: audit event model, retention controls, tamper checks.
- Tests: audit completeness and integrity tests.
- Definition of Done: Critical actions have complete trace trail.

### WP-0507: GDPR/TCPA Operational APIs
Phase: 5  
Priority: P1
- Objective: Implement mandatory privacy/consent operations.
- Depends On: WP-0506
- Inputs (Specs): 07
- Deliverables: export/delete/rectify, consent + STOP workflows.
- Tests: data rights and consent tests.
- Definition of Done: Regulatory operations function end-to-end.

---

## 10. Phase 6 Work Packages — MVP Business Flows

### WP-0650: Buffer and Stabilization Sprint
Phase: 6.5  
Priority: P0
- Objective: absorb schedule risk before deployment and launch hardening.
- Depends On: WP-0601..WP-0605
- Inputs (Specs): implementation plan
- Deliverables: defect burn-down report, stabilized integration suite, staging pass evidence.
- Tests: flaky test elimination and repeatability checks.
- Definition of Done: zero open P0/P1 MVP defects.

### WP-0601: Feature 1 — Booking Webhook Listener
Phase: 6  
Priority: P0
- Objective: Ingest appointments and trigger workflows.
- Depends On: Phase 5 complete
- Inputs (Specs): 06, 04
- Deliverables: appointment import and dedup flow.
- Tests: booking create/update/cancel integration tests.
- Definition of Done: Webhook events correctly map to internal state.

### WP-0602: Feature 2 — Reminder Sequence (48h/24h)
Phase: 6  
Priority: P0
- Objective: Deliver reminder automation with escalation.
- Depends On: WP-0601
- Inputs (Specs): 06, 03
- Deliverables: time-triggered reminders and wait windows.
- Tests: end-to-end reminder timing tests.
- Definition of Done: 48h and 24h reminders trigger correctly by timezone.

### WP-0603: Feature 3 — Response Classification
Phase: 6  
Priority: P0
- Objective: Classify inbound customer intent and update status/escalate.
- Depends On: WP-0602
- Inputs (Specs): 06, 03
- Deliverables: LLM classifier path + confidence threshold logic.
- Tests: classification intent matrix + low-confidence escalation tests.
- Definition of Done: Intent routing deterministic with fallback.

### WP-0604: Feature 4 — Review Request Automation
Phase: 6  
Priority: P0
- Objective: Trigger post-appointment review requests safely.
- Depends On: WP-0603
- Inputs (Specs): 06, 03
- Deliverables: +6h review workflow and optional follow-up.
- Tests: appointment completion to review message E2E tests.
- Definition of Done: Flow avoids cancelled/no-show edge cases.

### WP-0605: MVP Admin Dashboard Surface
Phase: 6  
Priority: P1
- Objective: Minimal operational UI for status and overrides.
- Depends On: WP-0405
- Inputs (Specs): 01, 06
- Deliverables: appointment list/detail/metrics pages.
- Tests: UI contract tests.
- Definition of Done: Operators can monitor and intervene manually.

---

## 11. Phase 7 Work Packages — Deployment and Operations

### WP-0701: Service Packaging (systemd/launchd)
Phase: 7  
Priority: P0
- Objective: Stable daemonized runtime.
- Depends On: Phase 6 complete
- Inputs (Specs): 05
- Deliverables: service unit templates and install scripts.
- Tests: service restart and crash recovery tests.
- Definition of Done: Auto-start and restart are reliable.

### WP-0702: Guided Installer CLI
Phase: 7  
Priority: P0
- Objective: Install and configure in <30 min.
- Depends On: WP-0701
- Inputs (Specs): 05
- Deliverables: interactive installer flow.
- Tests: clean environment install tests.
- Definition of Done: Non-technical operators can complete install without manual patching.

### WP-0703: Backup, Restore, and Encryption
Phase: 7  
Priority: P0
- Objective: Data durability and recoverability.
- Depends On: WP-0701
- Inputs (Specs): 05, 07
- Deliverables: scheduled backups + restore command.
- Tests: restore integrity tests.
- Definition of Done: backup/restore verified regularly.

### WP-0704: Diagnostics and Troubleshooting Tooling
Phase: 7  
Priority: P0
- Objective: Fast incident triage.
- Depends On: WP-0701
- Inputs (Specs): 05
- Deliverables: `aro diagnose` commands + health bundles.
- Tests: known-failure scenario diagnostics tests.
- Definition of Done: Top operational issues detectable via diagnostics.

### WP-0705: Monitoring, Alerting, and Runbooks
Phase: 7  
Priority: P1
- Objective: Operational readiness for production support.
- Depends On: WP-0704
- Inputs (Specs): 05, 07
- Deliverables: alert rules, runbooks, on-call guide.
- Tests: alert trigger and runbook drill tests.
- Definition of Done: team can execute standard incident playbooks.

---

## 12. Phase 8 Work Packages — Production Readiness & Launch

### WP-0801: Full Regression and Quality Gate Run
Phase: 8  
Priority: P0
- Objective: Ensure no hidden regressions.
- Depends On: Phase 7 complete
- Inputs (Specs): all
- Deliverables: full test evidence pack.
- Tests: unit + integration + E2E all green.
- Definition of Done: release candidate quality baseline met.

### WP-0802: Performance and SLO Validation
Phase: 8  
Priority: P0
- Objective: Validate non-functional requirements.
- Depends On: WP-0801
- Inputs (Specs): 06, 05
- Deliverables: performance report and tuning updates.
- Tests: `k6` benchmark suite (required), `Artillery` suite (optional), webhook and messaging latency tests under load.
- Definition of Done: P95 targets met or formally accepted with mitigation.

### WP-0803: Security and Compliance Verification Pass
Phase: 8  
Priority: P0
- Objective: Verify production security posture.
- Depends On: WP-0801
- Inputs (Specs): 07, 04
- Deliverables: security checklist signoff artifact.
- Tests: auth/webhook/rate-limit abuse tests.
- Definition of Done: critical security controls validated.

### WP-0804: Incident Rehearsal and Recovery Drill
Phase: 8  
Priority: P0
- Objective: Prove operational resilience.
- Depends On: WP-0803
- Inputs (Specs): 05, 07
- Deliverables: drill reports for P0/P1 scenarios.
- Tests: tabletop + technical failover exercises.
- Definition of Done: response times and procedures meet runbook expectations.

### WP-0805: GO/NO-GO and Production Launch
Phase: 8  
Priority: P0
- Objective: Controlled launch with rollback ready.
- Depends On: WP-0804
- Inputs (Specs): all
- Deliverables: release notes, launch checklist, rollback command sheet.
- Tests: final smoke tests in production-like environment.
- Definition of Done: GO decision signed with evidence links.

---

## 13. Execution Cadence

- Daily: Local CI Gate before each push.
- Per phase: gate review before phase close.
- Weekly: risk and schedule review against MVP scope lock.
- Release: fail-closed if security/reliability gates are not green.

---

## 14. Handoff Instructions (Human + AI Agent)

When assigning any work package:
1. Include exact WP ID.
2. Include spec links and acceptance criteria.
3. Require Local CI Gate evidence in PR description.
4. Require rollback notes for schema/runtime changes.
5. Reject completion claims without test artifacts.

---

## 15. Done Criteria for This Document

This work package doc is valid only if:
- all phases (0–8) are represented,
- Local CI pre-push gate is explicitly mandatory,
- each package is executable without verbal clarification.
