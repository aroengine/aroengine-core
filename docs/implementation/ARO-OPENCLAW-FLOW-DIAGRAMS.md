# ARO + OpenClaw Integration Diagrams

Date: 2026-02-22

## 1) End-to-end ARO flow

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as Profile Web UI
  participant BFF as Profile Backend (BFF)
  participant CORE as Core Engine (SoR + Orchestrator)
  participant BUS as Command/Event Bus
  participant EX as OpenClaw-Executor (Adapter/Governor)
  participant OCR as External OpenClaw Runtime (Skill Engine)
  participant EXT as External APIs (Booking/SMS/WA/Payments/Reviews)

  U->>UI: Click / configure / view status
  UI->>BFF: REST/GraphQL: "Enable ARO for Clinic X"
  BFF->>CORE: Command: ConfigureProfile + Policies/Templates
  CORE-->>BFF: Ack (command accepted)
  BFF-->>UI: OK + show onboarding steps

  Note over EXT,CORE: External world produces triggers (booking events, message replies, time triggers)

  EXT-->>CORE: Webhook/Event: booking_created(appointmentId)
  CORE->>CORE: Validate + Transition FSM (booked -> pending_confirm)
  CORE->>BUS: Emit Command: SendReminder(appointmentId, templateId)

  BUS-->>EX: Deliver Command (at-least-once)
  EX->>EX: Dedupe/idempotency check
  EX->>OCR: Invoke Skill: messaging.send(template, recipient, vars)
  OCR->>EXT: Call API: WhatsApp/SMS send
  EXT-->>OCR: Result: sent(messageId)
  OCR-->>EX: Skill Result: sent(messageId)
  EX-->>BUS: Emit Event: message_sent(appointmentId, messageId)

  BUS-->>CORE: Event: message_sent
  CORE->>CORE: Update state + append audit log

  EXT-->>CORE: Webhook: inbound_reply(messageId, text)
  CORE->>BUS: Command: ClassifyReply(text) (optional)
  BUS-->>EX: Command: ClassifyReply
  EX->>OCR: Skill: nlp.classify(text)
  OCR-->>EX: Result: intent=confirm|reschedule|cancel|other
  EX-->>BUS: Event: reply_classified(intent)

  BUS-->>CORE: Event: reply_classified
  CORE->>CORE: Apply policy; transition; emit next commands (reschedule_link, etc.)
```

Key point: Core Engine is authoritative. OpenClaw Runtime executes skills via the Executor. OpenClaw never directly runs the business.

## 2) OpenClaw-Executor ↔ External OpenClaw Runtime communication

```mermaid
flowchart LR
  subgraph CORE_SIDE["Core-side Delivery"]
    Q["Command Queue / Topic<br/>(at-least-once)"]
    EBUS["Event Bus / Topic<br/>(append-only)"]
  end

  subgraph EXECUTOR["OpenClaw-Executor (Your Adapter/Governor)"]
    IN["Inbox: command-consumer<br/>dedupe + ordering"]
    MAP["Command→Skill Router<br/>(allowlist + policy checks)"]
    ID["Idempotency Store<br/>(cmdId→result)"]
    SEC["Secrets Vault Client<br/>(scoped creds)"]
    OUT["Outbox: event-producer<br/>(transactional outbox)"]
  end

  subgraph OPENCLAW["External OpenClaw Runtime"]
    API["OpenClaw Invocation API<br/>(local HTTP/gRPC or SDK)"]
    SK["Skill Pack Runtime<br/>(your packaged skills)"]
    MEM["Local runtime memory<br/>(non-authoritative)"]
    TOOL["Tool connectors<br/>(WA/SMS/Booking/Stripe)"]
  end

  Q --> IN --> MAP
  MAP --> ID
  MAP --> SEC
  MAP --> API --> SK --> TOOL
  SK --> MEM
  API --> OUT --> EBUS

  classDef good fill:#e8ffe8,stroke:#2f7,stroke-width:1px;
  class EXECUTOR good;
```

Recommended contract between Executor and OpenClaw Runtime:
- Invocation is synchronous (request/response) per skill call
- Workflow is asynchronous (Core drives multi-step)
- Executor enforces allowlist, rate limits, idempotency, and credential scoping

## 3) Scaling External OpenClaw to 100k+ users

### 3A) Control plane / data plane architecture

```mermaid
flowchart TB
  subgraph CP["Control Plane (Global)"]
    REG["Tenant Registry<br/>plan, limits, routing"]
    CFG["Config Service<br/>Profile Packs + Skill Packs versions"]
    SECR["Secrets Service<br/>KMS + rotation + scoped tokens"]
    DEP["Deployment Controller<br/>rollouts/health/autoscale"]
  end

  subgraph CORE["Core Engine Cluster (Stateless)"]
    API["API Gateway"]
    ORCH["Core Engine Pods<br/>(commands/events/state machine)"]
    OUTBOX["Outbox Publisher"]
  end

  subgraph BUS["Messaging Backbone"]
    CMD["Commands Topics<br/>partitioned by tenantId"]
    EVT["Events Topics<br/>partitioned by tenantId"]
    DLQ["DLQ + Retry Topics"]
  end

  subgraph DP["Data Plane (Sharded by tenantId)"]
    EX1["Executor Pool Shard A"]
    EX2["Executor Pool Shard B"]
    EX3["Executor Pool Shard C"]
    OC1["OpenClaw Runtime Pool A<br/>(replicas)"]
    OC2["OpenClaw Runtime Pool B<br/>(replicas)"]
    OC3["OpenClaw Runtime Pool C<br/>(replicas)"]
  end

  API --> ORCH --> OUTBOX --> CMD
  EVT --> ORCH

  CP --> CORE
  CP --> DP

  CMD --> EX1 --> OC1
  CMD --> EX2 --> OC2
  CMD --> EX3 --> OC3

  OC1 --> EVT
  OC2 --> EVT
  OC3 --> EVT

  CMD --> DLQ
  EVT --> DLQ
```

### 3B) Partitioning and sticky routing

- Partition command topics by `tenantId` (consistent hashing)
- Bind partitions to bounded Executor workers
- Route tenant-to-runtime with consistent hashing + healthy fallback

### 3C) Deployment options

- Option 1: Hosted Executors + Hosted OpenClaw Runtime (recommended at 100k+)
- Option 2: Hosted Core + Customer-hosted Executor/OpenClaw (best for strict locality)

### 3D) Runtime scaling and safety

- Keep OpenClaw Runtime as stateless as possible
- Bound per-runtime concurrency
- Split pools by workload type when needed
- Ensure idempotent retries with dedupe keys for non-idempotent providers