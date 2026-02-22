# System Architecture Specification
**Appointment Revenue Optimizer (ARO)**
Version: 1.0
Date: 2026-02-22

## 1. Executive Summary

The Appointment Revenue Optimizer (ARO) is a profile-driven autonomous agent platform built on the OpenClaw framework. It reduces no-shows and increases revenue for appointment-based businesses through intelligent workflow automation, customer memory management, and adaptive messaging.

### 1.1 Positioning
"Revenue infrastructure for appointment-based businesses."

### 1.2 Core Platform Scope (Domain-Agnostic)
- Booking event ingestion
- Reminder automation (48h/24h)
- Confirmation classification and handling
- No-show recovery workflow
- Idempotent processing, retry, and rate limiting
- Authentication, authorization, and audit logging

### 1.3 Vertical Profiles

**Current default profile (Phase 1):** `healthcare`
- Dental clinics
- Aesthetic clinics
- Physiotherapy centers
- Private medical practices

**Future profiles (post-MVP):**
- Salon
- Legal consults
- Coaching
- Other appointment-based services

### 1.4 Service Boundary Contract (ADR-0006)

Architecture is governed by `docs/implementation/ADR-0006-core-engine-service-boundaries.md`.

**Required service decomposition**:
- `core-engine` (independent service): stateless command processing + workflow execution + canonical event publishing.
- `profile-backend` (per profile): auth/tenant boundary, policy overlays, template resolution, projection/read models.
- `profile-ui` (per profile): profile-specific UX only, never talks directly to core-engine.

**Core API contracts**:
- Command API (`/v1/commands`): profile backends submit idempotent commands.
- Event API (`/v1/events`): profile backends consume canonical events with cursor/replay support.
- Profile Pack Interface: profile behavior remains additive and cannot mutate core contracts.

### 1.5 OpenClaw Placement (Executor Plane)

- OpenClaw runs behind Core Engine as an **OpenClaw Executor** action plane.
- Core Engine decides transitions deterministically; OpenClaw Executor performs side-effecting skills.
- OpenClaw execution outcomes are normalized into canonical Event API events.
- Profile UI never calls OpenClaw runtime directly.

## 2. Architecture Overview

### 2.1 High-Level System Architecture

```
                        ┌─────────────────────────┐
                        │   Admin Dashboard       │
                        │ (Metrics + Controls)    │
                        └────────────┬────────────┘
                                     │
                             ┌───────▼────────┐
                             │  Orchestrator   │
                             │  (Workflow FSM) │
                             └───────┬────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
┌───────▼────────┐          ┌────────▼────────┐          ┌────────▼────────┐
│ Booking API     │          │ Messaging API    │          │ Payment API     │
│ (Calendly etc)  │          │ (WhatsApp/SMS)   │          │ (Stripe)        │
└───────┬────────┘          └────────┬────────┘          └────────┬────────┘
        │                             │                             │
        └──────────────┬──────────────┴──────────────┬─────────────┘
                       │                             │
                 ┌─────▼────────┐             ┌──────▼────────┐
                 │ Customer DB  │             │  Event Store   │
                 │ (State)      │             │  (Audit Log)   │
                 └──────────────┘             └───────────────┘
```

### 2.2 OpenClaw-Centric Architecture

**Runtime Requirement (MVP)**:
- OpenClaw `>=1.0.0 <2.0.0` (pin exact version in deployment config)
- Required capabilities validated pre-install:
  - skill registry + execution API
  - persistent memory store interface
  - event/time trigger scheduling
  - tool/API integration hooks
  - retry/error middleware hooks

**Runtime Verification Gate**:
- Installer must run `aro openclaw:diagnose` before first boot.
- If capability checks fail, installation must stop with actionable errors.

```
                          ┌───────────────────────────┐
                          │   Product Installer UI    │
                          │  (CLI + Optional Panel)   │
                          └────────────┬──────────────┘
                                       │
          ┌────────────────────────────┼──────────────────────────────┐
          │                            │                              │
┌─────────▼─────────┐       ┌──────────▼───────────┐       ┌──────────▼─────────┐
│ OpenClaw Runtime  │       │  Skill Registry +    │       │  Deployment Layer   │
│ (Agent Engine)    │       │  Workflow Catalog     │       │ (Local or Cloud)    │
│ (Daemon Service)  │       │                       │       │ (Installer or VM)   │
└─────┬─────────────┘       └─────────┬─────────────┘       └─────────────┬──────┘
      │                                │                                   │
      ▼                                ▼                                   ▼
┌──────────────┐       ┌─────────────────────────┐        ┌─────────────────────────┐
│ Execution    │       │ Memory Store + Schema   │        │ External Tools & APIs   │
│ Skills (JS)  │◀─────▶│ (Structured State Model) │◀──────▶│ Booking, SMS, Payments, │
│              │       │                         │        │ CRM, Reviews API, etc.  │
└──────────────┘       └─────────────────────────┘        └─────────────────────────┘
```

## 3. Component Specifications

### 3.1 OpenClaw Runtime
**Functionality**: Core agent execution engine
**Technology**: OpenClaw OSS framework
**Version Contract (MVP)**: OpenClaw `>=1.0.0 <2.0.0`
**Responsibilities**:
- Skill execution and orchestration
- Memory persistence
- Trigger scheduling and dispatch
- Tool integration management
- Error handling and retry logic

**Configuration Requirements**:
- Model selection (GPT-4, Claude, etc.)
- API credential management
- Execution environment setup
- Resource limits and quotas

**Compatibility Policy**:
- Pin exact runtime version per release (no floating `latest` in production).
- Any OpenClaw major version upgrade requires compatibility validation and a new ADR.

### 3.2 Orchestrator (Workflow FSM)

**Type**: Deterministic event-driven workflow engine
**Not**: Fully autonomous LLM-driven decision maker

**Core Responsibilities**:
- State machine management per appointment
- Event routing and dispatch
- Retry logic execution
- Escalation handling
- Workflow sequencing

**LLM Usage** (Limited scope):
- Tone adaptation in messages
- Response classification (Yes/No/Reschedule intent detection)
- Smart follow-up message drafting

**Not for LLM**:
- Business logic decisions
- Appointment state transitions
- Risk scoring calculations
- Trigger timing decisions

### 3.3 Skill Registry & Workflow Catalog

**Description**: Product differentiation layer - pre-built, domain-specific automation modules

**Skill Structure**:
```javascript
module.exports = {
  name: "sendReminder",
  version: "1.0",
  description: "Send appointment reminder message",
  inputs: ["customerId", "appointmentId"],
  run: async (ctx) => {
    const {customer, appointment} = ctx.memory
    const message = ctx.templates.render("reminder", {
      date: appointment.date,
      service: appointment.serviceType
    })
    await ctx.callApi("sms.send", { to: customer.phone, body: message })
    ctx.appendMemory("remindersSent", new Date())
  }
}
```

**Workflow Structure**:
```yaml
workflow:
  name: "appointment-reminder-sequence"
  triggers:
    - event: "booking_created"
    - time: "48h before appointment"
    - time: "24h before appointment"
  steps:
    - skill: "sendReminder"
      on_success: "logEvent"
      on_failure: "escalateToAdmin"
```

### 3.4 Memory Store & Schema

**Type**: Structured persistent memory (not prompt-based)
**Storage**: Local database (SQLite for self-hosted, PostgreSQL for cloud)

**Purpose**:
- Customer behavior tracking
- Appointment state management
- Risk scoring data
- Audit trail
- Business metrics aggregation

### 3.5 External API Integration Layer

**Booking APIs** (Phase 1 - pick ONE):
- Calendly
- Acuity Scheduling
- Square Appointments
- Custom webhook endpoint

**Messaging APIs**:
- Twilio (SMS)
- WhatsApp Business API
- Vonage

**Payment APIs**:
- Stripe (payment links only - no auto-charging)

**Review APIs** (Optional):
- Google My Business
- Trustpilot
- Custom review collection

### 3.6 Admin Dashboard

**Scope** (MVP):
- List view of appointments
- Status overview
- Manual override controls
- Simple metrics (no-show rate, confirmation rate)

**Not in MVP**:
- Advanced analytics
- Multi-branch management
- Custom reporting
- CRM features

## 4. Design Principles

### 4.1 Deterministic First, AI Second
- Business logic in code, not prompts
- State transitions are rule-based
- LLMs used only for communication layer

### 4.2 Structured Memory, Not Prompt Memory
- All state in database schemas
- No context stuffing
- Retrievable and auditable

### 4.3 Human-in-Loop for Critical Actions
- No auto-cancellations
- No auto-payments
- Manual override always available

### 4.4 Packaging Over Building
- Leverage OpenClaw runtime
- Ship pre-configured skills
- Reduce installation friction

## 5. Deployment Architecture

### 5.1 Deployment Options

**Option A: Self-Hosted (Recommended for MVP)**
- User installs on Mac Mini, server, or VPS
- OpenClaw runs as daemon service
- Data stays local
- User owns API credentials

**Option B: Managed Cloud (Phase 2)**
- ARO manages VM per customer
- Still isolated instances
- Easier onboarding
- Recurring hosting fee

### 5.2 Installation Workflow

1. User downloads installer (CLI + wizard)
2. CLI configures:
   - OpenClaw runtime installation
   - API credentials input
   - Booking system connection
   - Messaging service setup
3. User selects vertical profile template (`healthcare` default for MVP)
4. Skill packs auto-installed
5. Agent boots and runs initial workflow test
6. Dashboard accessible on localhost or custom domain

## 6. Scalability Considerations

### 6.1 Per-Instance Limits (MVP)
- Up to 1,000 appointments/month per instance
- Single location/business
- 1 booking system integration
- 1 messaging provider

### 6.2 Growth Path
- Multi-location support
- Advanced analytics
- AI-tuned messaging optimization
- Custom workflow creation UI

## 7. Technology Stack

### 7.1 Core Runtime
- OpenClaw framework (Node.js based, pinned per release)
- Node.js v18+
- SQLite (self-hosted) or PostgreSQL (cloud)

### 7.2 Skills Development
- JavaScript/TypeScript
- JSON configuration files
- YAML workflow definitions

### 7.3 Admin Dashboard (Optional)
- React/Next.js
- REST API or GraphQL
- TailwindCSS

### 7.4 Deployment
- Docker (optional containerization)
- Linux service management (systemd)
- PM2 for process management

## 8. Performance Requirements

### 8.1 Response Times
- Webhook processing: < 2 seconds
- Message sending: < 5 seconds
- Dashboard load: < 1 second

### 8.2 Reliability
- 99.5% uptime for daemon service
- Automatic retry on API failures (3 attempts)
- Dead letter queue for failed messages

### 8.3 Data Retention
- Active appointments: 6 months
- Historical data: 2 years
- Audit logs: 3 years

## 9. Success Metrics

### 9.1 Product Metrics
- No-show reduction: 30-50% target
- Confirmation rate: >80%
- Message response rate: >60%
- Average appointment value retained per month

### 9.2 Technical Metrics
- Skill execution success rate: >98%
- API integration uptime: >99%
- Message delivery rate: >95%
- Workflow completion rate: >97%

## 10. Constraints & Guardrails

### 10.1 System Guardrails
- Never auto-cancel appointments
- Never auto-charge payments
- Never provide medical advice
- All outgoing messages logged
- Rate limiting on messages (max 3 per customer per day)

### 10.2 Compliance Requirements
- GDPR compliance (data export, deletion)
- TCPA compliance (SMS consent required)
- Data encryption at rest and in transit

**Profile Overlay (healthcare default)**:
- HIPAA considerations (no PHI in messages)
- Medical-advice prevention guardrail enabled

## 11. Future Architecture Considerations

### 11.1 Parallel Build: Compliance Engine
While ARO generates revenue, build OpenClaw-based compliance monitoring:
- Regulatory feed monitoring
- Document classification
- Audit workflow automation
- Knowledge graph construction

### 11.2 Integration Expansion
- Calendar integrations (Google Calendar, Outlook)
- CRM connectors (HubSpot, Salesforce)
- Accounting software (QuickBooks, Xero)
- Reputation management platforms

---

## Appendix A: Architecture Decision Records

### ADR-001: OpenClaw as Runtime
**Decision**: Build on OpenClaw vs. custom agent framework
**Rationale**: 
- Faster time to market
- Proven autonomous execution
- Community support
- Focus on domain value, not infrastructure
**Status**: Accepted

### ADR-002: Deterministic Orchestration
**Decision**: Rule-based state machine vs. LLM-driven decisions
**Rationale**:
- Predictability required for business logic
- Cost efficiency
- Debugging and auditing
- Regulatory compliance
**Status**: Accepted

### ADR-003: Self-Hosted First
**Decision**: Self-hosted deployment vs. multi-tenant SaaS
**Rationale**:
- Data privacy concerns in healthcare
- Lower initial infrastructure cost
- Competitive differentiation
- Customer control
**Status**: Accepted

### ADR-004: Runtime Fallback if OpenClaw Unavailable
**Decision**: If OpenClaw compatibility checks fail, run ARO orchestrator in degraded local runtime mode until OpenClaw contract is restored.
**Fallback Scope (MVP)**:
- Keep deterministic workflows and data persistence active
- Disable non-critical dynamic skill loading
- Keep webhook ingestion, reminders, and admin visibility active
**Rationale**:
- Avoid total service outage from upstream runtime incompatibility
- Preserve core revenue-protection workflows
**Status**: Accepted

---

**Document Control**
- Author: Product Team
- Reviewers: Engineering, Product, Compliance
- Approval Date: TBD
- Next Review: 90 days post-launch
