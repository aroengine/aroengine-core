# ADR-0006: Core Engine Service Boundaries and Profile Contracts

- **Status**: Accepted
- **Date**: 2026-02-22
- **Deciders**: ARO Architecture
- **Supersedes**: None
- **Related Docs**: `docs/specs/01_system_architecture.md`, `docs/specs/03_workflow_orchestration.md`, `docs/specs/04_api_integrations.md`

## Context

ARO must support multiple vertical profile experiences (healthcare now, salon/legal/coaching later) without forking core orchestration logic.

The system needs:
- a reusable domain-agnostic workflow engine,
- independent profile-specific backend/UI layers,
- stateless horizontal scaling,
- strict idempotency and audit guarantees.

## Decision

Adopt a **3-layer product architecture** with an internal OpenClaw execution plane:

1. **Core Engine Service** (independent, stateless, horizontally scalable)
2. **Profile Backend (BFF) per profile** (`healthcare`, future profiles)
3. **Profile UI per profile**
4. **OpenClaw Executor** (internal action runner; not exposed directly to UI)

Core Engine remains the deterministic authority and exposes stable **Command API** and **Event API** contracts. Profile-specific behavior is supplied via **Profile Pack interface** loaded by profile backends (not by core). OpenClaw Executor performs side-effecting skill execution under Core control.

## Service Boundaries

## 1) Core Engine Service (Domain-Agnostic)

**Responsibilities**
- Execute deterministic workflow/state-machine transitions
- Process commands idempotently
- Emit canonical workflow/domain events
- Enforce retry/backoff, DLQ, rate-limits, and guardrail hooks
- Persist workflow state, events, idempotency keys, and audit trail

**Non-Responsibilities**
- Vertical-specific copy, templates, legal/compliance policy details
- Profile-specific UI concerns
- Tenant/profile onboarding UX

**Scaling Model**
- Stateless API workers (N replicas)
- Queue consumers partitioned by `tenantId + workflowId`
- Shared persistence (DB + event/outbox store + cache)

## 2) Profile Backend (BFF)

**Responsibilities**
- AuthN/AuthZ and tenant isolation at profile boundary
- Validate profile policy overlays
- Resolve templates/messages/business rules from profile pack
- Translate profile use-cases into Core Engine commands
- Subscribe to Core Engine events and project read models for profile UI

## 3) Profile UI

**Responsibilities**
- Profile-specific UX, terminology, and workflows
- Calls only profile backend endpoints

## 4) OpenClaw Executor (Internal)

**Responsibilities**
- Run OpenClaw runtime per tenant or per deployment
- Execute approved skill invocations requested by Core Engine
- Return execution outcomes as canonical events

**Non-Responsibilities**
- Workflow/state transition decisions
- Direct profile UI access
- Bypass of Core idempotency/audit/guardrail enforcement

**Boundary Rule**
- OpenClaw Executor is an action runner behind Core Engine. It never becomes the source of truth for business state transitions.

## Deployment Modes

### Mode A: Shared Core + Multiple Profile BFF/UI stacks
- One Core Engine service fleet
- One BFF+UI stack per profile
- OpenClaw Executor runs per tenant or per deployment target and connects securely to Core Engine

### Mode B: Isolated profile stacks
- Each profile has dedicated BFF/UI deployment
- Still reuses same Core Engine contract/service
- OpenClaw Executor can be customer-hosted on-prem with the same Core contract

## OpenClaw-First Wrapper Artifacts

Commercial wrapper packaging is defined as:

1. **ARO Profile Pack** (loaded by profile backend)
  - policy overlays, templates, command mappings, event projectors
2. **OpenClaw Skill Pack** (loaded by OpenClaw Executor)
  - booking/messaging/payment/review execution skills
3. **Operational Wrapper Layer**
  - installer/onboarding/update channel + support + diagnostics

This keeps ARO as the deterministic product layer while OpenClaw remains execution runtime.

## API Contract: Command API (Core Engine)

Base path: `/v1/commands`

### Common headers
- `Authorization: Bearer <service-token>`
- `X-Tenant-Id: <tenantId>`
- `Idempotency-Key: <unique-key>`
- `X-Correlation-Id: <uuid>`

### Command envelope

```json
{
  "commandId": "cmd_01J...",
  "commandType": "appointment.schedule_reminders",
  "tenantId": "tenant_123",
  "profile": "healthcare",
  "aggregate": {
    "type": "appointment",
    "id": "apt_123"
  },
  "payload": {
    "appointmentId": "apt_123",
    "scheduledAt": "2026-03-15T14:00:00Z",
    "timezone": "America/New_York"
  },
  "metadata": {
    "requestedBy": "profile-backend",
    "requestedAt": "2026-02-22T10:15:00Z"
  }
}
```

### Endpoints
- `POST /v1/commands` — enqueue/execute command (idempotent)
- `GET /v1/commands/{commandId}` — command status
- `GET /v1/workflows/{workflowId}` — workflow state snapshot

### Response (accepted)

```json
{
  "commandId": "cmd_01J...",
  "status": "accepted",
  "workflowId": "wf_01J...",
  "correlationId": "1d8f..."
}
```

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid timezone",
    "details": {
      "field": "payload.timezone"
    },
    "retryable": false
  }
}
```

## API Contract: Event API (Core Engine)

Core Engine is source-of-truth publisher. Profile backends consume via pull/push.

### Canonical event envelope

```json
{
  "eventId": "evt_01J...",
  "eventType": "appointment.confirmed",
  "occurredAt": "2026-03-14T09:00:00Z",
  "tenantId": "tenant_123",
  "profile": "healthcare",
  "aggregate": {
    "type": "appointment",
    "id": "apt_123"
  },
  "payload": {
    "appointmentId": "apt_123",
    "customerId": "cus_456"
  },
  "metadata": {
    "workflowId": "wf_01J...",
    "correlationId": "1d8f...",
    "causationId": "cmd_01J..."
  }
}
```

### Endpoints
- `GET /v1/events?tenantId=...&after=<cursor>&limit=...` — cursor-based event stream
- `POST /v1/subscriptions` — register webhook sink (optional)
- `POST /v1/subscriptions/{id}/replay` — replay from cursor/time

### Delivery guarantees
- At-least-once delivery
- Consumers must deduplicate via `eventId`
- Ordering guaranteed per `aggregate.id` partition only

## Internal Contract: Core Engine ↔ OpenClaw Executor

OpenClaw Executor is treated as a side-effecting tool plane under Core Engine control.

### Execution command types (examples)
- `messaging.send_reminder`
- `booking.request_reschedule_link`
- `payments.generate_deposit_link`

### Resulting canonical events (examples)
- `message.sent`
- `message.delivery_failed`
- `customer.confirmation_received`
- `deposit.link_created`

### Execution constraints
- Core-authorized command required before any skill side effect
- Idempotency key propagated end-to-end (`commandId` + tool execution key)
- Correlation chain preserved command → execution → event
- Executor outputs must be normalized into canonical Event API envelopes

## API Contract: Profile Pack Interface

Profile packs are loaded by profile backends and must be additive overlays.

### Interface

```typescript
export interface ProfilePack {
  profileId: string;
  version: string;

  policies: {
    validation: ValidationPolicy[];
    compliance: CompliancePolicy[];
    guardrails: GuardrailPolicy[];
  };

  templates: {
    messages: Record<string, MessageTemplate>;
    prompts: Record<string, PromptTemplate>;
  };

  commandMappings: Array<{
    profileAction: string;
    commandType: string;
    transform: string;
  }>;

  eventProjections: Array<{
    eventType: string;
    projector: string;
  }>;
}
```

### Invariants
- Must not mutate core command/event schemas
- Must not bypass guardrails, idempotency, or audit hooks
- Must be semver versioned and backward compatible within major version

## Data and Reliability Constraints

- Core writes through outbox pattern for event publication
- Exactly-once effect is achieved via idempotent command handling + dedupe
- `Idempotency-Key` retention minimum 72h
- Correlation IDs required across command→workflow→event chain

## Security Constraints

- mTLS or signed service tokens between BFF and Core Engine
- mTLS or signed service tokens between Core Engine and OpenClaw Executor
- Tenant isolation by mandatory `X-Tenant-Id` + authorization policy
- No plaintext secrets in profile packs or logs

## OpenClaw-Specific Guardrails

- **Skill Permission Manifest** per tenant/deployment (deny-by-default)
- **Core-side rate limiting** for all side-effecting commands
- **Human override checkpoints** for high-risk actions
- **Deterministic template enforcement** with forbidden content filters

## Classification Residency Rule

Reply classification execution location must be configured per tenant as one of:
- `core-engine` (centralized LLM service path), or
- `openclaw-executor` (local/privacy path)

Both modes cannot be active simultaneously for the same tenant.

## Consequences

### Positive
- Single reusable Core Engine across many verticals
- Independent release cadence per profile UI/BFF
- Horizontal scale without sticky sessions

### Trade-offs
- More infrastructure components (Core + BFF + event projection)
- Requires strict contract governance and versioning

## Rollout Plan

1. Publish this ADR and treat contracts as v1 stable baseline
2. Implement Core Command/Event APIs and contract tests
3. Migrate healthcare backend to Profile Pack v1
4. Implement OpenClaw Skill Pack v1 and Core↔OpenClaw contract tests
5. Add second profile as proof of reuse without core changes

## Production Baseline Freeze Policy

This ADR defines the **production v1 baseline** for architecture boundaries and contracts.

- No further contract or boundary changes are required for production GO.
- Changes are only introduced when new features or new profile capabilities require them.
- Any non-additive contract change requires:
  - a new ADR or ADR amendment,
  - updated contract + replay/idempotency tests,
  - explicit GO/NO-GO gate signoff.

Allowed without ADR change:
- additive profile pack templates/policies/mappings,
- additive command/event types that preserve envelope invariants,
- additive operational tooling and diagnostics.

## Verification Checklist

- [ ] Core Engine has zero profile-specific branching in business logic
- [ ] Profile backend uses Profile Pack for templates/policies
- [ ] OpenClaw Executor runs only Core-authorized skills
- [ ] Command API enforces idempotency and correlation headers
- [ ] Event API supports replay and cursor consumption
- [ ] Contract tests pass for Command/Event/Profile interfaces
