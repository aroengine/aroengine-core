# Appointment Revenue Optimizer (ARO) — Implementation Plan

**Product:** Appointment Revenue Optimizer (ARO)  
**Version:** 1.0  
**Status:** Ready to Execute  
**Last Updated:** 2026-02-22  
**Classification:** Internal

---

## 1. Plan Objective

This plan converts the existing ARO specs into an execution sequence that can be handed to:
- a human engineering team, or
- an AI coding agent,

and still produce a **production-ready** system.

This plan is dependency-driven (what must exist first), not feature-hype-driven.

### 1.1 Core + Profile Delivery Model

- Deliver **Core Platform** capabilities first (domain-agnostic): booking events, reminders, confirmations, no-show recovery, idempotency, retries, rate limits, auth, and audit.
- Deliver `healthcare` as the default **Vertical Profile** in Phase 1.
- Future profiles (salon, legal consults, coaching, etc.) must be additive overlays and must not alter Core contracts.

### 1.2 Architecture ADR and Contract Baseline

- Adopt `docs/implementation/ADR-0006-core-engine-service-boundaries.md` as mandatory architecture baseline.
- Implement and validate three explicit boundaries:
 - Implement and validate core boundaries:
  - `core-engine` independent stateless service
  - `profile-backend` (BFF) per profile
  - `profile-ui` per profile
  - `openclaw-executor` internal side-effect action runner
- Treat these as v1 stable contracts:
  - Command API (`/v1/commands`)
  - Event API (`/v1/events` + replay/subscriptions)
  - Profile Pack interface (policies/templates/mappings; additive only)
  - Core↔OpenClaw execution contract

Production baseline freeze:
- ADR-0006 boundaries/contracts are the production v1 baseline for this plan.
- No additional integration refactors are required for production GO.
- Contract/boundary changes are only required when new features/profile capabilities are added.
- Non-additive changes require ADR update + contract/replay/idempotency test updates + GO/NO-GO signoff.

---

## 2. Inputs Audited

This plan is based on:
- `docs/specs/01_system_architecture.md`
- `docs/specs/02_data_models.md`
- `docs/specs/03_workflow_orchestration.md`
- `docs/specs/04_api_integrations.md`
- `docs/specs/05_deployment_infrastructure.md`
- `docs/specs/06_product_requirements.md`
- `docs/specs/07_security_compliance.md`
- `docs/specs/README.md`
- `docs/implementation/ADR-0006-core-engine-service-boundaries.md`

Reference structure inspiration used from prior internal implementation-plan patterns.

---

## 3. Hard Scope Lock (MVP)

### 3.1 Must Ship (Only 4 Features)
1. Booking webhook listener
2. Reminder sequence (48h + 24h)
3. Confirmation classification
4. Post-appointment review request

Note: These are Core Platform features. Current acceptance criteria are implemented under the `healthcare` profile.

### 3.2 Explicitly Out for MVP
- AI upsell engine
- LTV optimization beyond basic risk/metrics
- Multi-location support
- CRM replacement
- Advanced analytics
- Auto-cancel and auto-charge behaviors

---

## 4. Dependency Graph (Execution Truth)

Implementation order is constrained by these dependencies:

1. **Platform foundation first**
   - Runtime, config, secrets, DB migrations, logging baseline
2. **Data model before workflows**
   - Customer/Appointment/Event/Workflow tables and indices must exist before orchestration
3. **Trigger/workflow engine before external automation**
   - Deterministic state machine + retry + DLQ before adapters are connected
4. **Adapters before end-to-end flows**
   - Booking, Messaging, Payment adapters + webhook verification + idempotency
5. **Security and resilience before production traffic**
   - Circuit breakers, rate limits, encryption, audit trails, auth hardening
6. **Installer + operations before GA**
   - Install path, backup/restore, diagnostics, runbooks, SLO monitoring

If this order is broken, reliability and operability collapse later.

---

## 5. Global Engineering Rules (Mandatory)

1. Deterministic business logic first; LLM only for classification/tone/content.
2. Every external API call goes through:
   - rate limiting,
   - retry policy,
   - circuit breaker,
   - structured error mapping.
3. All webhooks must be signature-verified and idempotent.
4. No plaintext credentials in DB/logs/code.
5. No feature merges without tests and passing CI.
6. No production release without incident runbooks and recovery drills.
7. Local CI Gate must pass before every push to remote (`origin` or any shared remote).

### 5.1 Mandatory Local CI Gate (Pre-Push)

Before every push, run:

```bash
npm run lint && npm run typecheck && npm run test && npm run test:integration
```

Minimum contract:
- Block push if any command fails.
- Re-run the Local CI Gate after rebasing/merging from main.
- No exception path for "small changes".

Recommended automation:
- Git pre-push hook executes the Local CI Gate.
- CI in remote pipeline remains required (local gate is additive, not replacement).

Setup commands (run once per clone):

```bash
git init   # only if repo is not initialized yet
./scripts/install-git-hooks.sh
```

---

## 6. Phased Delivery Plan (Priority Order)

## Phase 0 — Program Setup & Architecture Lock (Day 1)

**Goal:** Eliminate ambiguity before coding starts.

### Tasks
- 0.1 Confirm runtime and language baseline:
  - Node.js LTS (v20 preferred)
  - TypeScript strict mode
  - OpenClaw runtime integration contract
- 0.1a Publish ADR-0006 and sign off service boundaries + contracts
- 0.2 Define repo structure:
  - `apps/core-engine`, `apps/profile-backend-healthcare`, `apps/profile-ui-healthcare`, `apps/openclaw-executor`, `packages/workflow-engine`, `packages/integrations`, `packages/shared`
- 0.3 Define environment contracts:
  - `.env.example`, secret names, rotation policy
- 0.4 Define CI gates:
  - lint, type-check, unit tests, integration tests, migration checks
- 0.4b Define security gates:
  - dependency scan, secret scan, baseline SAST
- 0.4c Define staging environment contract:
  - isolated test credentials, synthetic data, promotion criteria
- 0.5 Publish architecture decision log (ADR-001..)

### Gate
- Architecture lock signed off (no unresolved foundational decisions)

---

## Phase 1 — Core Platform Foundation (Days 2–5)

**Goal:** Running service skeleton with secure config, health checks, and migration pipeline.

### Tasks
- 1.1 Bootstrap API service and internal module boundaries
- 1.2 Add config loader with schema validation (fail-fast startup)
- 1.3 Add structured logging (JSON) + correlation IDs
- 1.4 Implement health/readiness endpoints (`/health`, `/ready`)
- 1.5 Add database migration framework and first migration scaffold
- 1.6 Add secrets management integration (env-only for MVP)
- 1.7 Add baseline error envelope and error codes

### Tests
- startup with valid/invalid config
- health/readiness endpoint tests
- migration up/down smoke tests
- error envelope contract tests

- Scaffold `core-engine` service boundary and a profile backend adapter boundary
### Gate
- Service boots consistently in local/dev CI with green migrations

---

## Phase 2 — Data Layer & Persistence (Days 6–10)

**Goal:** Implement spec-driven schema and repositories.

### Tasks
- 2.1 Implement tables/models:
  - `customers`, `appointments`, `reminder_logs`, `events`, `workflow_instances`, `business_config`
- 2.2 Add indexes and partial indexes from spec
- 2.3 Add status enums and state transition validation
- 2.4 Implement repository layer (idempotent upserts for webhook flows)
- 2.5 Add event append/query APIs (immutable event log)
- 2.6 Add monthly partition strategy for `events` (or equivalent operational plan)
- 2.7 Add migration rollback templates for every forward migration

### Tests
- model validation tests (E.164, dates, status rules)
- repository CRUD + upsert idempotency tests
- transition rules tests
- index/migration verification tests
- rollback migration smoke tests (up -> down -> up)

### Gate
- Database layer supports all MVP entities and workflow state persistence

---

## Phase 3 — Workflow Engine (Deterministic Orchestration) (Days 11–16)

**Goal:** Run appointment workflows independent of external systems.

### Tasks
- 3.1 Implement workflow state machine (`PENDING/RUNNING/WAITING/RETRYING/COMPLETED/FAILED/CANCELLED`)
- 3.2 Implement appointment state machine transition guard
- 3.3 Implement trigger engine:
  - event triggers
  - time-offset triggers
  - pattern triggers
- 3.4 Implement retry executor (exponential backoff)
- 3.5 Implement dead letter queue + retry/archival operations
- 3.6 Implement guardrails:
  - no auto-cancel,
  - no auto-charge,
  - message-rate cap,
  - no medical-advice generation
- 3.7 Implement escalation rules to admin

### Tests
- state transition matrix tests
- trigger evaluation tests
- timeout and retry behavior tests
- DLQ lifecycle tests
- guardrail violation tests

### Gate
- Engine executes reminder workflow in simulation with deterministic outcomes

---

## Phase 4 — Integration Layer (Adapters + Webhooks) (Days 17–23)

**Goal:** Connect external systems safely and consistently.

### Tasks
- 4.1 Implement Booking adapter interface + first provider (Calendly recommended)
- 4.2 Implement Messaging adapter (Twilio SMS first)
- 4.3 Implement Payment adapter (Stripe payment links only)
- 4.4 Implement webhook endpoints:
  - signature verification,
  - payload normalization,
  - idempotent ingestion,
  - dedup keys
- 4.5 Implement outbound message tracking + delivery updates
- 4.6 Implement inbound message processing for classification flow

### Tests
- webhook signature verification tests (positive/negative/replay)
- adapter contract tests with mocked providers
- idempotency tests for duplicate webhook delivery
- failure mapping tests

### Gate
- End-to-end event ingestion to workflow trigger works for real provider sandboxes

---

## Phase 5 — Resilience, Security, Compliance Baseline (Days 24–30)

**Goal:** Make MVP safe to run in production.

### Tasks
- 5.1 Add circuit breakers per integration domain (messaging/booking/payment)
- 5.2 Add outbound rate limiters (token bucket configs per provider)
- 5.3 Add inbound API and webhook rate limits
- 5.4 Add retry-with-jitter policies by integration type
- 5.5 Add fallback strategies:
  - queue and re-attempt reminders when provider unavailable
- 5.6 Implement authn/authz for admin API
- 5.7 Implement encryption-at-rest for sensitive config fields
- 5.8 Enforce TLS requirements and secure headers
- 5.9 Implement full audit logging for critical actions
- 5.10 Implement GDPR/TCPA operational actions:
  - consent checks,
  - opt-out handling,
  - data export/delete flows

### Tests
- circuit breaker state transition tests (closed/open/half-open)
- rate limit and abuse tests
- security tests for webhook/auth bypass attempts
- encryption/decryption tests
- consent and opt-out flow tests

### Gate
- Security + resilience checklist from spec is green and evidenced

---

## Phase 6 — MVP Product Flows (Days 31–36)

**Goal:** Implement the 4 committed MVP business workflows fully.

### Tasks
- 6.1 Booking webhook listener flow
- 6.2 Reminder sequence (48h + 24h) with wait windows
- 6.3 Response classification flow (LLM with confidence threshold + escalation)
- 6.4 Post-appointment review request flow (+ optional rebooking prompt)
- 6.5 Admin dashboard minimum views:
  - appointments list/details,
  - status updates,
  - metrics basics

### Tests
- integration tests per feature flow
- E2E tests for booking -> reminder -> response -> status update
- E2E tests for appointment completed -> review request flow

### Gate
- All 4 MVP features pass acceptance criteria from product spec

## Phase 6.5 — Buffer and Stabilization (Days 37–43)

**Goal:** absorb schedule risk before deployment packaging and launch hardening.

### Tasks
- 6.5.1 Burn down integration defects and flaky tests
- 6.5.2 Validate staging environment with production-like configs
- 6.5.3 Close open security and performance findings

### Gate
- No P0/P1 defects open for MVP scope

---

## Phase 7 — Deployment, Installer, and Operations (Days 44–50)

**Goal:** Make system deployable and supportable by non-technical operators.

### Tasks
- 7.1 Package service processes (systemd + launchd templates)
- 7.2 Implement installer CLI flow (guided setup)
- 7.3 Add config generation and connection tests during install
- 7.4 Add backup/restore jobs and verification
- 7.5 Add diagnostics command set (`aro diagnose` family)
- 7.6 Add monitoring hooks, alerts, and log rotation
- 7.7 Create troubleshooting playbooks and recovery procedures

### Tests
- fresh install test on macOS + Linux
- upgrade and rollback smoke tests
- backup/restore integrity tests
- chaos test: provider outage and service restart

### Gate
- Clean install to healthy runtime in <30 min with guided flow

---

## Phase 8 — Production Readiness & Launch Gate (Days 51–56)

**Goal:** Verify readiness with objective gates, then launch.

### Tasks
- 8.1 Run full regression suite (unit/integration/E2E)
- 8.2 Load/performance validation:
  - webhook <2s avg processing
  - message send <5s avg
  - tooling: `k6` (required), `Artillery` (optional cross-check)
  - scenarios: booking webhook bursts, reminder batch sends, inbound reply spikes
- 8.3 Reliability validation against SLO targets
- 8.4 Security validation pass (including hardening checklist)
- 8.5 Incident response rehearsal (P0/P1 simulations)
- 8.6 Pilot customer runbook + support handoff
- 8.7 Cut `v1.0.0` release candidate and rollback plan

### Gate
- **GO/NO-GO decision** with evidence package

---

## 7. Detailed Work Packages (Handoff-Friendly)

Each task in phases above must be delivered as a work package with:

1. **Objective**
2. **Inputs (spec sections)**
3. **Implementation steps**
4. **Tests required**
5. **Artifacts produced** (code, config, docs)
6. **Definition of done**

Template:

```md
### WP-<ID>: <Task Title>
Objective:
Inputs:
Implementation:
Tests:
Artifacts:
DoD:
Risks:
Rollback:
```

---

## 8. Definition of Done (Global)

A task is complete only when all are true:

- Implementation merged
- Unit tests pass
- Integration tests pass (if cross-module)
- E2E tests pass (if user-facing)
- Lint/type checks pass
- Security implications reviewed
- Observability/logging added for failure paths
- Documentation updated
- Rollback path documented

---

## 9. Production Readiness Gates (Must Be Green)

### 9.1 Reliability
- 99.5% uptime target supportable by current ops setup
- no unhandled crash loops
- retry + DLQ functioning and observable

### 9.2 Security & Compliance
- webhook signatures enforced
- secrets encrypted and never logged
- admin auth and session protections active
- GDPR export/delete flows working
- TCPA consent + STOP handling working

### 9.3 Performance
- webhook processing P95 <= 2s
- reminder send path P95 <= 5s (provider latency excluded where documented)

### 9.4 Operability
- diagnostics command works
- backup/restore tested
- runbooks available for top failure scenarios

---

## 10. Suggested Team/Agent Parallelization

### Track A — Core Runtime
- Phases 1, 3

### Track B — Data & APIs
- Phases 2, 4

### Track C — Security/Resilience
- Phase 5 (starts once Track A+B interfaces stabilize)

### Track D — Product + Dashboard
- Phase 6 (starts after workflow contracts are stable)

### Track E — DevOps/Installer
- Phase 7 (starts during late Phase 5)

Final convergence is Phase 8 only.

---

## 11. Immediate Next Actions (Execution Kickoff)

1. Create implementation repo structure and CI gates (Phase 0).
2. Generate the first 10 work packages from Phases 1–2.
3. Enforce pre-push Local CI Gate for all contributors and coding agents.
4. Run weekly GO/NO-GO against this plan (not against ad-hoc progress).

---

## 12. Change Control

Any requested work that is not in MVP scope must include:
- business justification,
- impact on timeline,
- risk impact,
- explicit approval.

Default behavior: **defer** until after MVP production launch.

---

## 13. Acceptance Statement

If executed in order with the gates above, this plan yields a production-ready ARO MVP that is:
- deployable,
- secure enough for target market baseline,
- operationally supportable,
- extensible for post-MVP growth.

