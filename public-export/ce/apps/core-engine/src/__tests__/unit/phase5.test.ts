import { describe, expect, it } from 'vitest';

import {
  AdminAuthService,
  AuditLogService,
  CircuitBreaker,
  FallbackQueue,
  PrivacyService,
  RetryWithJitter,
  TokenBucketRateLimiter,
} from '../../server/phase5.js';

describe('Phase 5 resilience and security services', () => {
  it('opens and half-opens circuit breaker around repeated failures', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      timeoutMs: 1,
    });

    await expect(
      breaker.execute(async () => {
        throw new Error('fail-1');
      }),
    ).rejects.toThrowError();

    await expect(
      breaker.execute(async () => {
        throw new Error('fail-2');
      }),
    ).rejects.toThrowError();

    await expect(
      breaker.execute(async () => {
        return 'should-not-run';
      }),
    ).rejects.toThrowError('Circuit breaker open');
  });

  it('enforces token bucket limits', () => {
    const limiter = new TokenBucketRateLimiter(2, 60_000);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(false);
  });

  it('retries with jitter then succeeds', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const retry = new RetryWithJitter(
      () => 0,
      async (ms) => {
        delays.push(ms);
      },
    );

    const result = await retry.run(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('transient');
      }
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(delays).toEqual([250, 500]);
  });

  it('queues fallback payloads', () => {
    const queue = new FallbackQueue();
    queue.enqueue({ appointmentId: 'apt-1' });
    expect(queue.size()).toBe(1);
    expect(queue.drain()).toHaveLength(1);
    expect(queue.size()).toBe(0);
  });

  it('issues/verifies admin tokens and protects audit chain integrity', () => {
    const auth = new AdminAuthService('secret', 'admin', 'password');
    const token = auth.issueToken('admin', 'password');
    expect(token).not.toBeNull();
    expect(auth.verifyToken(token!)).toBe(true);
    expect(auth.issueToken('admin', 'wrong')).toBeNull();

    const audit = new AuditLogService();
    audit.append('event.created', 'system', { id: '1' });
    audit.append('event.updated', 'system', { id: '1' });
    expect(audit.verifyIntegrity()).toBe(true);
  });

  it('supports consent, opt-out, export, and delete flows', () => {
    const privacy = new PrivacyService();
    privacy.setCustomerData('cust-1', { phone: '+15551234567' });

    const consent = privacy.grantConsent('cust-1');
    expect(consent.consentGiven).toBe(true);

    const optOut = privacy.optOut('cust-1');
    expect(optOut.consentGiven).toBe(false);

    const exported = privacy.exportCustomer('cust-1');
    expect(exported['customer']).toBeDefined();

    privacy.deleteCustomer('cust-1');
    expect(privacy.exportCustomer('cust-1')['customer']).toBeNull();
  });
});