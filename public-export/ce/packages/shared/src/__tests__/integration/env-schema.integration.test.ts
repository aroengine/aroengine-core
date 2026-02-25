import { describe, expect, it } from 'vitest';

import { loadEnvConfig } from '../../config/env-schema.js';

describe('env schema startup validation', () => {
  it('loads a valid env contract', () => {
    const parsed = loadEnvConfig({
      NODE_ENV: 'development',
      PORT: '3000',
      HOST: '127.0.0.1',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/aro',
      JWT_SECRET: 'x'.repeat(32),
      ENCRYPTION_KEY: 'a'.repeat(64),
      ENCRYPTION_SALT: 'b'.repeat(16),
      CALENDLY_API_KEY: 'Bearer test-token',
      CALENDLY_WEBHOOK_SECRET: 'c'.repeat(32),
      TWILIO_ACCOUNT_SID: 'AC_TEST_ACCOUNT_SID_PLACEHOLDER',
      TWILIO_AUTH_TOKEN: 'd'.repeat(32),
      TWILIO_PHONE_NUMBER: '+15551234567',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
      LLM_API_KEY: 'llm-key',
      LLM_MODEL: 'gpt-4o-mini',
    });

    expect(parsed.PORT).toBe(3000);
  });

  it('fails fast on missing required values', () => {
    expect(() => loadEnvConfig({})).toThrowError();
  });
});
