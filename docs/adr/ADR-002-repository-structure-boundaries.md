# ADR-002: Repository Structure and Boundaries

- Status: Accepted
- Date: 2026-02-22
- Related WP: WP-0002

## Decision

The monorepo structure is fixed as:

- apps/core-engine
- apps/profile-backend-healthcare
- apps/profile-ui-healthcare
- apps/openclaw-executor
- packages/workflow-engine
- packages/integrations
- packages/shared

## Rationale

This aligns implementation boundaries with ADR-0006 and prevents profile-specific logic from leaking into core-engine.
