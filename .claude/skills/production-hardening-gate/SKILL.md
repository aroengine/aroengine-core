---
name: production-hardening-gate
description: Run a strict production hardening and product-outcome gate for SkillGate: governance enforcement proof, evidence-backed claims, conversion path readiness, moat clarity, and GO/NO-GO verdict based on product trust and revenue-aligned signals.
---

# Production Hardening Gate

Use this skill when asked for production readiness, release adjudication, or strict GO/NO-GO.

Decision posture:

- Optimize for product outcomes, not owner preference and not agent convenience.
- Prefer decisions that increase defensible moat, trust, and conversion.
- Reject work that adds features without strengthening enforcement, evidence, or distribution.

## Scope

Validate these gates in order (fail-closed):
1. Claim-ledger hard gate + docs launch controls
2. Tier-gating proof paths (`hunt`/`retroscan` CLI + API)
3. Enterprise trust controls (signed token presence, subject binding, mode/authority lock abuse tests)
4. Performance & latency SLO gates (p50/p95/p99 + cold-start where applicable)
5. Resilience & degradation gates (timeouts, retries, circuit breakers, backpressure, graceful failure)
6. Observability & supportability gates (structured logs, traces, metrics, runbooks, on-call debug flow)
7. CLI/API matrix (including `saas`, `private_relay`, `airgap` coverage)
8. Data integrity & migration gates (schema migrations, idempotency, replay safety)
9. Packaging/release hardening (wheel + sdist + install smoke + publish rehearsal)
10. Lint/type checks
11. Product-outcome gates (moat clarity, SEO intent fit, CTA conversion path)
12. Final self-review + reflection + GO/NO-GO checklist

### Product-Outcome Gates (mandatory)

1. Moat gate:
- Messaging must define SkillGate as governance/enforcement/evidence control plane, not scanner clone.
- Write-path approvals and signed evidence must be visibly central in product narrative.

2. SEO intent gate:
- Core pages must target high-intent phrases:
`AI code security governance`, `secure AI coding pipeline`, `AI coding policy enforcement`, `audit evidence for AI-generated code`.
- Claims on these pages must map to proof artifacts.

3. CTA gate:
- Primary CTA must point to runnable first proof flow:
`scan -> policy decision -> approval (if required) -> signed evidence pack`.
- CTA path must be testable and reproducible from docs.

4. Revenue proxy gate:
- Track and report:
`proof-pack generation rate`, `high-risk write block rate`, `approval-gated write rate`, `claim-to-proof coverage`.
- If metrics are missing, release is `NO-GO`.

## Required Commands (minimum)

Run from repo root:

```bash
./venv/bin/pytest -m slow tests/slo/ -q

# Performance & latency: require repeatable benchmarks (no network noise)
./venv/bin/pytest -m perf tests/perf/ -q -rs
python scripts/perf/bench_cli.py --runs 10 --json /tmp/skillgate-perf-cli.json
python scripts/perf/bench_api.py --runs 10 --json /tmp/skillgate-perf-api.json

# Resilience: failure-mode tests (timeouts/retries/backpressure)
./venv/bin/pytest -m resilience tests/resilience/ -q -rs

# Observability: log/trace/metrics schema checks
./venv/bin/pytest tests/observability/ -q

python scripts/quality/check_claim_ledger.py
./venv/bin/pytest tests/docs/test_pricing_launch_controls.py -q
./venv/bin/pytest tests/unit/test_hunt/test_cli.py tests/unit/test_retroscan/test_cli.py -q
./venv/bin/pytest tests/unit/test_api/test_hunt_api.py tests/unit/test_api/test_retroscan_api.py -q
./venv/bin/pytest tests/unit/test_api/test_entitlements_api.py tests/unit/test_entitlement/test_usage_authority.py tests/unit/test_cli/test_entitlement_gates.py -q
./venv/bin/pytest tests/e2e/test_cli_command_matrix.py -q
./venv/bin/pytest tests/e2e/test_api_command_matrix.py -q

# Debuggability/support: verify runbooks & operational docs exist and render
./venv/bin/pytest tests/docs/test_runbooks_present.py -q
./venv/bin/pytest tests/docs/test_troubleshooting_render.py -q

./venv/bin/pytest -m slow tests/e2e/test_packaging_release.py -q -rs
python -m build --sdist --wheel --outdir /tmp/skillgate-dist-check
python -m twine check /tmp/skillgate-dist-check/*
./venv/bin/ruff check .
./venv/bin/mypy --strict skillgate/
```

## Fail-Closed Rules

- Any skipped test in packaging/perf/resilience gates is a red flag unless explicitly documented and approved.
- `sdist` must produce a tarball; do not allow skip-based pass.
- Matrix coverage must include positive + negative + regression paths.
- Non-local runtime paths must fail-close when signed entitlement token/subject checks fail.
- Do not mark GO if any required gate is missing from CI.
- Do not mark GO if moat messaging is scanner-like or if CTA lacks proof-backed flow.
- Do not mark GO if claims exist without artifact links.

### Performance/Latency
- Require baseline benchmarks to be reproducible (≥ 10 runs) and stored as artifacts.
- Require explicit thresholds for p95 latency and error rate (documented in repo); failing thresholds is NO-GO.
- Any performance regression vs last release baseline must be explained (root cause + mitigation or rollback plan).

### Resilience
- Verify timeouts are set (no unbounded waits) and retries are bounded with jitter/backoff.
- Verify graceful degradation paths exist (partial results, cached reads, fail-open is NOT allowed for security gates).
- Any single point of failure in critical paths must have mitigation (redundancy, circuit breaker, or clear operational workaround).

### Observability/Supportability
- Logs must be structured and include correlation IDs for all request/command executions.
- Tracing must identify top-level operations (`hunt`, `retroscan`, entitlements verification) with spans.
- Metrics must include: request rate, error rate, latency (p50/p95/p99), saturation signals, and queue depth where applicable.
- A runbook must exist for each critical service/worker, including: how to reproduce, how to collect evidence, and rollback steps.

## Self-Review + Reflection (required)

Before issuing GO/NO-GO, perform a brief self-audit and record it in the output:

1. **Correctness:** Did we validate the intended invariants (entitlements, tier gating, claim-ledger) with negative tests?
2. **Performance:** What are the p50/p95/p99 numbers for CLI and API? Any regression vs baseline? Why?
3. **Resilience:** What happens under dependency failure (timeouts, 5xx, slow downstream)? Do we degrade safely?
4. **Supportability:** Could on-call debug this in < 15 minutes using logs/traces/runbooks? What evidence proves it?
5. **Scalability:** What is the scaling bottleneck (CPU/memory/IO/queue/db)? What is the mitigation plan?
6. **Maintainability:** Are modules cohesive, interfaces stable, and configuration explicit? Any tech debt that blocks GA?
7. **Product Advantage:** Why is this hard for scanner-first competitors to copy quickly?
8. **Distribution Readiness:** Are SEO intent pages + CTA flow aligned to the shipped proof path?

If any answer is unclear, assume NO-GO until clarified with evidence.

## Output Contract

Return:
1. Findings ordered by severity with `file:line` and a one-line impact.
2. GO/NO-GO checklist with explicit green/red status per gate (Scope items 1–12).
3. Performance snapshot table (p50/p95/p99, error rate, baseline comparison, environment notes).
4. Resilience snapshot (tested failure modes + observed behavior + any gaps).
5. Supportability snapshot (log/trace evidence, runbook links/paths, and fastest debug path).
6. Product-outcome snapshot (`moat`, `SEO intent fit`, `CTA readiness`, `revenue proxies`) with pass/fail.
7. One-line final verdict: `GO` or `NO-GO`.
8. No mandatory environment variables to be placed in code; all to be mentioned in .env or .env.example with clear instructions. No fallbacks for mandatory environment variables that bypass checks.
