# Security Scan Baseline (WP-0006)

## CI Checks

- `npm run security:secrets` — regex-based repository secret scan.
- `npm run security:deps` — dependency audit with fail threshold.

## Current Dependency Threshold

- Audit failure threshold is set to `critical` (`npm audit --audit-level=critical`).
- Rationale: current upstream ESLint/minimatch advisories raise `high` severity findings in dev-tooling transitive dependencies.

## Follow-up

- Revisit threshold after next eslint/typescript-eslint upgrade cycle and tighten back to `high` when advisories are resolved.
