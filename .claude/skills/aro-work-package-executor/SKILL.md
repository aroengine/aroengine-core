---
name: aro-work-package-executor
description: Execute ARO implementation work packages from docs/implementation/IMPLEMENTATION-WORKPACKAGES.md.
  Provides structured execution of phases 0-8 with proper dependencies, tests, and
  gates. Use when implementing specific features or phases.
---

# ARO Work Package Executor

Execute implementation work packages from the ARO implementation plan with production-grade quality.

## ADR-0006 Governance (Mandatory)

Before executing any work package, enforce:

- `docs/implementation/ADR-0006-core-engine-service-boundaries.md`
- Independent `core-engine` boundary remains profile-agnostic.
- Profile-specific behavior is implemented only in profile backends via Profile Packs.
- Any command/event/profile interface change includes contract tests and versioning notes.

## Usage

Invoke this skill with a specific work package ID:
- `aro-work-package-executor WP-0101`
- `aro-work-package-executor WP-0201`
- Or by phase: `aro-work-package-executor phase-2`

## Work Package Reference

### Phase 0 — Program Setup (WP-0001 to WP-0005)

| ID | Title | Priority | Depends On |
|----|-------|----------|------------|
| WP-0001 | Runtime and Stack Lock | P0 | None |
| WP-0002 | Repository Structure and Boundaries | P0 | WP-0001 |
| WP-0003 | Environment and Secret Contract | P0 | WP-0001 |
| WP-0004 | Local + Remote CI Gate Setup | P0 | WP-0001 |
| WP-0005 | Architecture Decision Records Baseline | P1 | WP-0001..3 |

### Phase 1 — Core Platform (WP-0101 to WP-0106)

| ID | Title | Priority | Depends On |
|----|-------|----------|------------|
| WP-0101 | API Bootstrap and Module Wiring | P0 | Phase 0 |
| WP-0102 | Config Validation Layer | P0 | WP-0101 |
| WP-0103 | Structured Logging + Correlation | P0 | WP-0101 |
| WP-0104 | Health and Readiness Probes | P0 | WP-0101 |
| WP-0105 | Migration Pipeline Foundation | P0 | WP-0101 |
| WP-0106 | Error Envelope Standardization | P1 | WP-0101 |

### Phase 2 — Data Layer (WP-0201 to WP-0206)

| ID | Title | Priority | Depends On |
|----|-------|----------|------------|
| WP-0201 | Core Schema — Customers and Appointments | P0 | Phase 1 |
| WP-0202 | Reminder Logs and Delivery Tracking | P0 | WP-0201 |
| WP-0203 | Event Store and Immutable Events | P0 | WP-0201 |
| WP-0204 | Workflow Instance Persistence | P0 | WP-0201 |
| WP-0205 | Business Config and Encrypted Integrations | P0 | WP-0201 |
| WP-0206 | Validation and Transition Rule Enforcement | P1 | WP-0201 |

### Phase 3 — Workflow Engine (WP-0301 to WP-0306)

| ID | Title | Priority | Depends On |
|----|-------|----------|------------|
| WP-0301 | Appointment State Machine Engine | P0 | Phase 2 |
| WP-0302 | Workflow Runtime State Machine | P0 | WP-0301 |
| WP-0303 | Trigger Engine (Event/Time/Pattern) | P0 | WP-0302 |
| WP-0304 | Retry and Backoff Executor | P0 | WP-0302 |
| WP-0305 | Dead Letter Queue | P0 | WP-0304 |
| WP-0306 | Guardrails and Escalation | P0 | WP-0302 |

### Phase 4 — Integrations (WP-0401 to WP-0405)

| ID | Title | Priority | Depends On |
|----|-------|----------|------------|
| WP-0401 | Booking Adapter Interface + Calendly Adapter | P0 | Phase 3 |
| WP-0402 | Messaging Adapter (Twilio SMS First) | P0 | WP-0401 |
| WP-0403 | Payment Adapter (Stripe Payment Links) | P0 | WP-0401 |
| WP-0404 | Webhook Verification and Idempotency | P0 | WP-0401..3 |
| WP-0405 | Internal Admin APIs | P1 | WP-0404 |

### Phase 5 — Security & Resilience (WP-0501 to WP-0507)

| ID | Title | Priority | Depends On |
|----|-------|----------|------------|
| WP-0501 | Circuit Breakers Per Provider Domain | P0 | Phase 4 |
| WP-0502 | Outbound and Inbound Rate Limiting | P0 | WP-0501 |
| WP-0503 | Retry with Jitter + Fallback Queueing | P0 | WP-0501 |
| WP-0504 | Admin AuthN/AuthZ Hardening | P0 | WP-0405 |
| WP-0505 | Data Encryption and Secret Protection | P0 | WP-0205 |
| WP-0506 | Audit Logging and Compliance Flows | P0 | WP-0203 |
| WP-0507 | GDPR/TCPA Operational APIs | P1 | WP-0506 |

### Phase 6 — MVP Features (WP-0601 to WP-0605)

| ID | Title | Priority | Depends On |
|----|-------|----------|------------|
| WP-0601 | Feature 1 — Booking Webhook Listener | P0 | Phase 5 |
| WP-0602 | Feature 2 — Reminder Sequence (48h/24h) | P0 | WP-0601 |
| WP-0603 | Feature 3 — Response Classification | P0 | WP-0602 |
| WP-0604 | Feature 4 — Review Request Automation | P0 | WP-0603 |
| WP-0605 | MVP Admin Dashboard Surface | P1 | WP-0405 |

### Phase 7 — Deployment (WP-0701 to WP-0705)

| ID | Title | Priority | Depends On |
|----|-------|----------|------------|
| WP-0701 | Service Packaging (systemd/launchd) | P0 | Phase 6 |
| WP-0702 | Guided Installer CLI | P0 | WP-0701 |
| WP-0703 | Backup, Restore, and Encryption | P0 | WP-0701 |
| WP-0704 | Diagnostics and Troubleshooting Tooling | P0 | WP-0701 |
| WP-0705 | Monitoring, Alerting, and Runbooks | P1 | WP-0704 |

### Phase 8 — Production Launch (WP-0801 to WP-0805)

| ID | Title | Priority | Depends On |
|----|-------|----------|------------|
| WP-0801 | Full Regression and Quality Gate Run | P0 | Phase 7 |
| WP-0802 | Performance and SLO Validation | P0 | WP-0801 |
| WP-0803 | Security and Compliance Verification Pass | P0 | WP-0801 |
| WP-0804 | Incident Rehearsal and Recovery Drill | P0 | WP-0803 |
| WP-0805 | GO/NO-GO and Production Launch | P0 | WP-0804 |

## Execution Protocol

### Step 1: Validate Dependencies

Before starting any work package:

```bash
# Check dependency status
echo "Checking dependencies for WP-XXXX..."

# Verify prerequisite phases are complete
# This should be tracked in docs/implementation/PROGRESS.md
```

### Step 2: Read Spec Inputs

Each work package references spec sections. Read them first:

```
WP-0201 inputs: 02_data_models.md
WP-0401 inputs: 04_api_integrations.md
WP-0501 inputs: 04_api_integrations.md
```

### Step 3: Implement

Follow the implementation scope from the work package:

1. Create files/structures as specified
2. Write code following `aro-typescript-pro` standards
3. Include comprehensive error handling
4. Add structured logging

### Step 4: Write Tests

Before declaring complete:

```typescript
// Unit tests for the implementation
describe('WorkPackageComponent', () => {
  it('should [specific behavior from spec]', () => {
    // Test implementation
  });
});
```

### Step 5: Run Local CI Gate

```bash
npm run lint && npm run typecheck && npm run test && npm run test:integration
```

### Step 6: Update Progress

Update `docs/implementation/PROGRESS.md`:

```markdown
## WP-XXXX: Title
- Status: ✅ Complete / 🔄 In Progress / ⏳ Blocked
- Completed: YYYY-MM-DD
- Notes: [any relevant notes]
```

## Definition of Done

A work package is complete ONLY when ALL are true:

- [ ] Implementation merged to appropriate branch
- [ ] Unit tests pass with >80% coverage on new code
- [ ] Integration tests pass (if cross-module)
- [ ] E2E tests pass (if user-facing)
- [ ] Lint/type checks pass
- [ ] Security implications reviewed
- [ ] Observability/logging added for failure paths
- [ ] Documentation updated
- [ ] Rollback path documented
- [ ] Local CI gate passes

## Work Package Template

When creating new work packages or documenting completion:

```markdown
### WP-<ID>: <Title>
Phase: X
Priority: P0/P1
Status: ⏳/🔄/✅

**Objective:** [What this achieves]

**Inputs (Specs):**
- docs/specs/XX_document.md (lines X-Y)

**Implementation Scope:**
- [ ] Task 1
- [ ] Task 2

**Tests Required:**
- [ ] Unit test for X
- [ ] Integration test for Y

**Deliverables:**
- src/path/file.ts
- tests/path/file.test.ts

**Definition of Done:**
- [ ] All tests pass
- [ ] CI gate green
- [ ] Docs updated

**Risks:** [Known risks]

**Rollback:** [How to revert]
```

## Output Format

After completing a work package, provide:

```
📦 Work Package Completion Report

WP-ID: WP-XXXX
Title: [Work Package Title]
Phase: X
Duration: [time spent]

✅ Deliverables Created:
- src/path/file1.ts
- src/path/file2.ts
- tests/path/file1.test.ts

🧪 Test Results:
- Unit Tests: X passed, 0 failed
- Integration Tests: X passed, 0 failed
- Coverage: XX%

📊 CI Gate Results:
- Lint: ✅ Pass
- TypeCheck: ✅ Pass
- Tests: ✅ Pass

📝 Notes:
[Any relevant implementation notes]

🔄 Next Work Packages (unblocked):
- WP-XXXX
- WP-YYYY
```
