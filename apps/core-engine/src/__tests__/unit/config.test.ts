import { describe, expect, it } from 'vitest';

import { loadCoreEngineConfig } from '../../server/config.js';

const validEnv = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/aro',
  DATABASE_MIGRATION_LOCK_TIMEOUT: '30000',
  OPENCLAW_EXECUTOR_URL: 'http://127.0.0.1:3200',
  OPENCLAW_SHARED_TOKEN: 'openclaw-shared-token-test',
  OPENCLAW_PERMISSION_MANIFEST_VERSION: '1.0.0',
  CORE_COMMAND_QUEUE_FILE: '/tmp/aro-test-queue.json',
  CORE_DISPATCH_WORKER_INTERVAL_MS: '5000',
  CORE_DISPATCH_WORKER_MAX_ATTEMPTS: '3',
} as const;

describe('loadCoreEngineConfig', () => {
  it('parses a valid environment contract', () => {
    const config = loadCoreEngineConfig(validEnv);
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_MIGRATION_LOCK_TIMEOUT).toBe(30000);
  });

  it('fails fast on invalid values', () => {
    expect(() => loadCoreEngineConfig({ ...validEnv, PORT: 'abc' })).toThrowError(
      /Configuration errors/,
    );
  });
});