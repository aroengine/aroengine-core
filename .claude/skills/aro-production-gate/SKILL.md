---
name: aro-production-gate
description: Run strict production readiness gate for ARO. Validates reliability,
  security, performance, and operability before production release. Issues GO/NO-GO
  verdict with evidence. Use for Phase 8 and release decisions.
---

# ARO Production Readiness Gate

Final validation before production deployment. This gate is **fail-closed** - all criteria must pass for GO decision.

## Decision Posture

- **Optimize for production safety**, not developer convenience
- **Prefer explicit failures** over silent degradation
- **Require evidence** for all claims
- **No exceptions** for "minor" issues in production path

## Scope (Fail-Closed)

Validate these gates IN ORDER:

### 0. Architecture Contract Gate (MANDATORY)

| Control | Requirement | Verification |
|---------|-------------|--------------|
| ADR-0006 compliance | Core/Profile boundaries intact | Architecture review + import boundary checks |
| Core statelessness | No profile-specific branches in core-engine | Code audit |
| Command API contract | Required headers/envelope enforced | Contract tests |
| Event API contract | Canonical envelope + replay verified | Contract + replay tests |
| Profile Pack constraints | Additive overlays only | Schema checks |

### 1. Security Gate (MANDATORY)

| Control | Requirement | Verification |
|---------|-------------|--------------|
| Webhook signatures | All webhooks verified | Test with invalid signatures |
| Secrets encryption | No plaintext in DB/logs | Audit encrypted fields |
| Auth hardening | JWT/session policies enforced | Penetration test |
| TLS | 1.2+ required | SSL scan |
| Rate limiting | All endpoints protected | Load test |
| Input validation | Zod on all inputs | Fuzz test |
| SQL injection | Parameterized queries only | Code audit |
| Dependency scan | No critical CVEs | `npm audit` |

### 2. Reliability Gate (MANDATORY)

| Control | Target | Verification |
|---------|--------|--------------|
| Uptime | 99.5% | Health check monitoring |
| Retry logic | 3 attempts, exponential backoff | Failure injection |
| Circuit breakers | Open after 5 failures | Chaos test |
| Dead letter queue | All failed workflows captured | DLQ query |
| Graceful degradation | Service continues with degraded features | Provider outage simulation |

### 3. Performance Gate (MANDATORY)

| Metric | Target | Verification |
|--------|--------|--------------|
| Webhook processing p95 | ≤ 2s | Load test |
| Message send p95 | ≤ 5s | Load test |
| Dashboard load p95 | ≤ 1s | Load test |
| API response p95 | ≤ 1s | Load test |
| Memory usage | < 80% of limit | Memory profiling |
| CPU usage | < 70% average | CPU profiling |

### 4. Operability Gate (MANDATORY)

| Control | Requirement | Verification |
|---------|-------------|--------------|
| Health endpoint | `/health` and `/ready` | Manual check |
| Structured logs | JSON with correlation IDs | Log review |
| Metrics | Key metrics exported | Prometheus check |
| Runbooks | All failure scenarios documented | Runbook review |
| Diagnostics | `aro diagnose` works | Manual test |
| Backup/restore | Verified recovery | Restore drill |

### 5. Compliance Gate (MANDATORY)

| Control | Requirement | Verification |
|---------|-------------|--------------|
| GDPR export | Data export functional | Manual test |
| GDPR delete | Data deletion functional | Manual test |
| TCPA consent | Consent checks before SMS | Code audit |
| Opt-out handling | STOP processed within 24h | Manual test |
| Audit logs | 7-year retention | Config check |
| PHI protection | No PHI in messages | Template audit |

## Required Commands

Run from repo root:

```bash
# 1. Security validation
npm run security:audit
npm run lint:security
npm audit --audit-level=high

# 2. Full test suite
npm run test:all
npm run test:coverage

# 3. Performance tests
npm run test:perf

# 4. Integration tests
npm run test:integration

# 5. E2E tests
npm run test:e2e

# 6. Build verification
npm run build
npm run build:prod

# 7. Docker build (if applicable)
docker build -t aro:test .
docker run --rm aro:test npm run health:check

# 8. Backup/restore verification
npm run db:backup --output /tmp/aro-gate-backup.db
npm run db:restore --input /tmp/aro-gate-backup.db --verify
```

## Performance Test Protocol

```bash
# Using k6 or similar
k6 run tests/perf/webhook-load.js --out json=results.json

# Verify thresholds
# - http_req_duration:p95 < 2000  (webhook)
# - http_req_duration:p95 < 5000  (message send)
# - http_req_failed < 1%
```

Sample k6 test:

```javascript
// tests/perf/webhook-load.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up
    { duration: '1m', target: 50 },   // Stay at 50
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function() {
  const payload = JSON.stringify({
    event: 'appointment.created',
    data: { /* test data */ }
  });

  const res = http.post('http://localhost:3000/webhooks/calendly', payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time OK': (r) => r.timings.duration < 2000,
  });

  sleep(1);
}
```

## Security Test Protocol

```bash
# Dependency audit
npm audit --audit-level=high

# Secret scanning (use git-secrets or trufflehog)
git secrets --scan-history

# SSL/TLS check (if HTTPS enabled)
npx ssllabs-scan https://your-domain.com

# Webhook signature bypass test
curl -X POST http://localhost:3000/webhooks/calendly \
  -H "Content-Type: application/json" \
  -d '{"forged": "payload"}'
# Expected: 401 Unauthorized

# Rate limit test
for i in {1..200}; do
  curl -s http://localhost:3000/api/v1/admin/appointments > /dev/null
done
# Expected: 429 Too Many Requests

# SQL injection test (automated)
npm run test:security:injection
```

## Resilience Test Protocol

```bash
# 1. Circuit breaker test - simulate provider outage
# Stop mock Twilio server, verify circuit opens
npm run test:resilience:circuit-breaker

# 2. Database connection loss
# Kill DB connection, verify graceful degradation
npm run test:resilience:db-failover

# 3. Memory pressure test
npm run test:resilience:memory

# 4. Chaos test - random failures
npm run test:chaos
```

## Self-Review Checklist (REQUIRED)

Before issuing GO/NO-GO, answer:

### 1. Correctness
- [ ] All business logic matches spec requirements
- [ ] Edge cases handled (null, empty, invalid input)
- [ ] State transitions follow defined rules
- [ ] No race conditions in concurrent paths

### 2. Security
- [ ] No hardcoded secrets
- [ ] All webhooks signature-verified
- [ ] Input validation on all endpoints
- [ ] SQL injection prevented
- [ ] XSS prevented
- [ ] Rate limiting active

### 3. Reliability
- [ ] Retry logic implemented
- [ ] Circuit breakers functional
- [ ] Dead letter queue working
- [ ] Graceful degradation tested

### 4. Performance
- [ ] p95 latency targets met
- [ ] Memory usage acceptable
- [ ] No memory leaks detected
- [ ] Database queries optimized

### 5. Operability
- [ ] Health checks functional
- [ ] Structured logging enabled
- [ ] Runbooks complete
- [ ] Diagnostics working
- [ ] Backup/restore verified

### 6. Compliance
- [ ] GDPR export/delete functional
- [ ] TCPA consent handling working
- [ ] Audit logs complete
- [ ] No PHI in messages

## Output Contract

Return:

```markdown
# ARO Production Gate Report

**Date:** YYYY-MM-DD
**Version:** vX.Y.Z
**Environment:** [staging/production-candidate]

## 1. Security Gate

| Control | Status | Evidence |
|---------|--------|----------|
| Webhook signatures | ✅/❌ | [evidence] |
| Secrets encryption | ✅/❌ | [evidence] |
| Auth hardening | ✅/❌ | [evidence] |
| TLS | ✅/❌ | [evidence] |
| Rate limiting | ✅/❌ | [evidence] |
| Input validation | ✅/❌ | [evidence] |
| SQL injection | ✅/❌ | [evidence] |
| Dependency scan | ✅/❌ | [evidence] |

## 2. Reliability Gate

| Control | Status | Evidence |
|---------|--------|----------|
| Uptime target | ✅/❌ | [evidence] |
| Retry logic | ✅/❌ | [evidence] |
| Circuit breakers | ✅/❌ | [evidence] |
| Dead letter queue | ✅/❌ | [evidence] |
| Graceful degradation | ✅/❌ | [evidence] |

## 3. Performance Gate

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Webhook p95 | ≤2s | X.Xs | ✅/❌ |
| Message send p95 | ≤5s | X.Xs | ✅/❌ |
| Dashboard p95 | ≤1s | X.Xs | ✅/❌ |
| API p95 | ≤1s | X.Xs | ✅/❌ |
| Memory usage | <80% | XX% | ✅/❌ |

## 4. Operability Gate

| Control | Status | Evidence |
|---------|--------|----------|
| Health endpoints | ✅/❌ | [evidence] |
| Structured logs | ✅/❌ | [evidence] |
| Metrics | ✅/❌ | [evidence] |
| Runbooks | ✅/❌ | [evidence] |
| Diagnostics | ✅/❌ | [evidence] |
| Backup/restore | ✅/❌ | [evidence] |

## 5. Compliance Gate

| Control | Status | Evidence |
|---------|--------|----------|
| GDPR export | ✅/❌ | [evidence] |
| GDPR delete | ✅/❌ | [evidence] |
| TCPA consent | ✅/❌ | [evidence] |
| Opt-out handling | ✅/❌ | [evidence] |
| Audit logs | ✅/❌ | [evidence] |
| PHI protection | ✅/❌ | [evidence] |

## 6. Issues Found

| Severity | Description | Mitigation |
|----------|-------------|------------|
| Critical | [description] | [mitigation/blocker] |
| High | [description] | [mitigation] |
| Medium | [description] | [mitigation] |

## Final Verdict

**GO / NO-GO**

Reasoning: [Brief explanation of decision]

## Next Steps (if NO-GO)

1. [Required fix 1]
2. [Required fix 2]
3. Re-run production gate

---
Report generated by: [agent/person]
Approval required from: Engineering Lead, Product Owner
```

## Fail-Closed Rules

1. Any critical/high severity issue = NO-GO
2. Any gate section incomplete = NO-GO
3. Performance regression without explanation = NO-GO
4. Security vulnerability (any severity) = NO-GO
5. Missing runbook for critical path = NO-GO
6. Backup/restore not verified = NO-GO

## GO Criteria (ALL must be true)

- [ ] All 5 gates pass with ✅
- [ ] No critical or high severity issues
- [ ] Performance meets or exceeds targets
- [ ] Rollback plan documented and tested
- [ ] On-call rotation confirmed
- [ ] Incident response rehearsed
