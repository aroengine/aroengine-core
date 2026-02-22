# Staging Environment Contract (Phase 0)

## Purpose

Define minimum staging parity and promotion requirements before production release.

## Parity Rules

- Same major Node runtime as production (Node 20 LTS).
- Same schema migration version as production candidate.
- Same command/event/profile contracts as `main`.
- Isolated sandbox credentials for Calendly/Twilio/Stripe.

## Data Policy

- Synthetic or anonymized data only.
- No live PHI/PII copied from production.

## Promotion Gate

A release cannot promote unless all are green:

1. `npm run ci:local` equivalent checks pass in CI.
2. Contract tests pass for command/event/profile and core↔executor schemas.
3. Webhook signature verification tests pass.
4. Staging smoke checks pass (`/health`, `/ready`, workflow trigger smoke).

## Evidence

Store links to CI run, smoke output, and checklist in release notes.
