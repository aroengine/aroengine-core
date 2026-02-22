# ADR-004: Integration Adapter Pattern

- Status: Accepted
- Date: 2026-02-22
- Related WP: WP-0005

## Decision

External systems (Calendly, Twilio, Stripe) are integrated only through adapter interfaces in `packages/integrations`, while command authorization remains in `core-engine`.

## Consequences

- Provider-specific payloads are normalized before entering core workflows.
- Retries, idempotency, and error mapping are adapter responsibilities under core policies.
