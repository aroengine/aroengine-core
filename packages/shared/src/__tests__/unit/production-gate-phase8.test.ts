import { describe, expect, it } from 'vitest';

import { evaluateProductionGate } from '../../index.js';

describe('Phase 8 production gate evaluator', () => {
  it('returns GO when all gates are green', () => {
    const result = evaluateProductionGate({
      quality: {
        lint: true,
        typecheck: true,
        unitTests: true,
        integrationTests: true,
      },
      performance: {
        webhookP95Ms: 1500,
        messageSendP95Ms: 4000,
      },
      security: {
        webhookSignatureEnforced: true,
        secretsEncryptedAtRest: true,
        authEnabled: true,
        rateLimitEnabled: true,
      },
      incidents: {
        p0RunbookValidated: true,
        p1RunbookValidated: true,
      },
    });

    expect(result.decision).toBe('GO');
    expect(result.reasons).toHaveLength(0);
  });

  it('returns NO-GO with reasons when requirements fail', () => {
    const result = evaluateProductionGate({
      quality: {
        lint: true,
        typecheck: false,
        unitTests: true,
        integrationTests: true,
      },
      performance: {
        webhookP95Ms: 2400,
        messageSendP95Ms: 5300,
      },
      security: {
        webhookSignatureEnforced: false,
        secretsEncryptedAtRest: true,
        authEnabled: false,
        rateLimitEnabled: true,
      },
      incidents: {
        p0RunbookValidated: true,
        p1RunbookValidated: false,
      },
    });

    expect(result.decision).toBe('NO-GO');
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});