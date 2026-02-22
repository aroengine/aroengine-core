# Flow Conformance Matrix (Production GO)

Date: 2026-02-22

Purpose: map architecture flow edges to implemented code and test evidence, and identify residual non-code GO dependencies.

## A) UI/BFF/Core authority boundary

- Diagram edge: Profile UI and BFF submit commands to Core; Core is system of record.
- Implementation:
  - Core command ingress: `POST /v1/commands` in `apps/core-engine/src/server/routes.ts`
  - Deterministic event append + orchestration dispatch in Core route layer
- Evidence:
  - `apps/core-engine/src/__tests__/integration/core-openclaw-authority.contract.test.ts`
  - `apps/core-engine/src/__tests__/integration/server.integration.test.ts`
- Status: Conformant

## B) External trigger -> Core booking webhook -> command/event flow

- Diagram edge: booking event enters Core; Core emits command and event trail.
- Implementation:
  - `POST /v1/webhooks/booking` appends `booking.received`
  - Core dispatches `integration.twilio.send_sms` through Core-authorized executor path
  - Executor result normalized back as canonical event stream entries
  - Core emits domain event `message_sent` on successful reminder send normalization
- Evidence:
  - `apps/core-engine/src/server/routes.ts`
  - `apps/core-engine/src/__tests__/integration/server.integration.test.ts`
- Status: Conformant

## C) Inbound reply -> classify -> reply_classified event

- Diagram edge: inbound reply enters Core; optional classify command executes; classification event emitted.
- Implementation:
  - `POST /v1/webhooks/inbound-reply`
  - Core dispatches `integration.nlp.classify_reply`
  - Core appends `reply_classified`
  - Core applies deterministic policy follow-up:
    - `confirm/confirmed` -> emit `appointment.confirmed`
    - `reschedule` -> dispatch `integration.booking.request_reschedule_link`
    - `cancel` -> emit `appointment.cancel_requested`
- Evidence:
  - `apps/core-engine/src/server/routes.ts`
  - `apps/core-engine/src/__tests__/integration/server.integration.test.ts`
- Status: Conformant

## D) Core -> Executor authority contract and side-effect boundary

- Diagram edge: only Core-authorized commands flow to executor; no direct bypass to side effects from Core API surface.
- Implementation:
  - Core dispatch contract in `apps/core-engine/src/server/executor-contract.ts`
  - HTTP dispatcher in `apps/core-engine/src/server/openclaw-dispatcher.ts`
  - Core route layer has no `/v1/executions` endpoint
- Evidence:
  - `apps/core-engine/src/__tests__/integration/core-openclaw-authority.contract.test.ts`
- Status: Conformant

## E) Executor governance and runtime invocation

- Diagram edge: Executor performs policy/governance and invokes external runtime in CLI or Gateway mode.
- Implementation:
  - Runtime mode switch in `apps/openclaw-executor/src/index.ts`
  - Command allowlist and permission manifest checks
  - Tenant boundary controls:
    - required `x-tenant-id`
    - header/command tenant match
    - `OPENCLAW_ALLOWED_TENANTS` allowlist
    - per-tenant rate limit via `OPENCLAW_TENANT_RATE_LIMIT_PER_MINUTE`
  - Restart-safe idempotency persistence via `OPENCLAW_IDEMPOTENCY_STORE_FILE`
  - Secret-provider abstraction (default env-backed)
  - Persistent executor outbox append via `OPENCLAW_OUTBOX_FILE`
- Evidence:
  - `apps/openclaw-executor/src/__tests__/integration/executor.integration.test.ts`
- Status: Conformant

## F) Event API replay and subscriptions

- Diagram edge: canonical event envelopes with replay support.
- Implementation:
  - `GET /v1/events`
  - `POST /v1/subscriptions`
  - `POST /v1/subscriptions/:id/replay`
  - event append/list/replay in `apps/core-engine/src/server/event-stream.ts`
- Evidence:
  - `apps/core-engine/src/__tests__/integration/server.integration.test.ts`
- Status: Conformant (in-memory implementation)

## G) Remaining GO dependencies (non-code)

- Staging signoff/governance evidence is now captured in:
  - `docs/implementation/STAGING-GOVERNANCE-SIGNOFF-2026-02-22.md`
- Rollout approvals evidence package is now captured in:
  - `docs/implementation/ROLLOUT-APPROVALS-2026-02-22.md`
- Strict feature-by-feature implementation classification and evidence links are captured in:
  - `docs/implementation/FEATURE-IMPLEMENTATION-CHECKLIST-2026-02-22.md`
- No additional code gap identified against current diagrams and Core/Executor authority model.

## H) Residual architecture deltas vs full target diagram

- Full external async command bus (partitioned topic broker with independent consumers) is not yet implemented; current implementation provides in-process dispatch retries and DLQ events (`command.dispatch.retry` and `command.dispatch.dlq`) for resilience.
- Executor outbox is file-backed and persistent, but not a distributed transactional outbox integrated with a broker transaction boundary.
- Secret provider abstraction exists with env-backed implementation; external vault-backed provider integration remains a future hardening step.
