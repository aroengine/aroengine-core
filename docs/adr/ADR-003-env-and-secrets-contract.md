# ADR-003: Environment and Secrets Contract

- Status: Accepted
- Date: 2026-02-22
- Related WP: WP-0003

## Decision

All runtime environment variables are declared in `.env.example` and validated through `packages/shared/src/config/env-schema.ts`.

## Rules

- No runtime fallback defaults in application code.
- Invalid or missing required values must fail startup deterministically.
- Secrets must never be committed or logged.
