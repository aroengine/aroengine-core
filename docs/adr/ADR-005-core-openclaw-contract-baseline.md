# ADR-005: Core↔OpenClaw Contract Baseline

- Status: Accepted
- Date: 2026-02-22
- Related WP: WP-0009

## Decision

Core-engine sends only authorized executor commands; openclaw-executor emits canonical result events. The v1 schema contract is defined in `packages/shared/src/contracts/index.ts`.

## Consequences

- Side effects are isolated to openclaw-executor.
- Contract changes require schema+test updates and ADR review.
