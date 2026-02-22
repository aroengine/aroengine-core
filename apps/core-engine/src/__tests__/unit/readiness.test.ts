import { describe, expect, it } from 'vitest';

import { CoreEngineConfig } from '../../server/config.js';
import { createDefaultReadinessChecks } from '../../server/readiness.js';

const baseConfig: CoreEngineConfig = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/aro',
  DATABASE_MIGRATION_LOCK_TIMEOUT: 30000,
  OPENCLAW_EXECUTOR_URL: 'http://127.0.0.1:3200',
  OPENCLAW_SHARED_TOKEN: 'openclaw-shared-token-test',
  OPENCLAW_PERMISSION_MANIFEST_VERSION: '1.0.0',
};

describe('readiness', () => {
  it('returns up for supported db and non-empty migrations', async () => {
    const checks = createDefaultReadinessChecks(baseConfig, {
      async load() {
        return [{ id: 'm1', upSql: 'up', downSql: 'down' }];
      },
    });

    const statuses = await Promise.all(checks.map(async (check) => check.run()));
    expect(statuses).toContain('up');
  });

  it('returns down for invalid db url or empty migrations', async () => {
    const checks = createDefaultReadinessChecks(
      { ...baseConfig, DATABASE_URL: 'invalid' },
      {
        async load() {
          return [];
        },
      },
    );

    const services = await Promise.all(
      checks.map(async (check) => ({ name: check.name, status: await check.run() })),
    );

    expect(services.find((item) => item.name === 'database')?.status).toBe('down');
    expect(services.find((item) => item.name === 'migrations')?.status).toBe('down');
  });
});