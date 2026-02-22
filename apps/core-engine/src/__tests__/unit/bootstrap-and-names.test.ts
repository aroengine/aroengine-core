import { describe, expect, it } from 'vitest';

import {
  createCoreEngineServer,
  coreEngineServiceName,
} from '../../index.js';

describe('bootstrap and naming exports', () => {
  it('creates core-engine server with expected dependencies wired', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['HOST'] = '127.0.0.1';
    process.env['PORT'] = '3010';
    process.env['LOG_LEVEL'] = 'info';
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/aro';
    process.env['DATABASE_MIGRATION_LOCK_TIMEOUT'] = '30000';
    process.env['OPENCLAW_EXECUTOR_URL'] = 'http://127.0.0.1:3200';
    process.env['OPENCLAW_SHARED_TOKEN'] = 'openclaw-shared-token-test';
    process.env['OPENCLAW_PERMISSION_MANIFEST_VERSION'] = '1.0.0';
    process.env['CORE_COMMAND_QUEUE_FILE'] = '/tmp/aro-bootstrap-test-queue.json';
    process.env['CORE_DISPATCH_WORKER_INTERVAL_MS'] = '5000';
    process.env['CORE_DISPATCH_WORKER_MAX_ATTEMPTS'] = '3';

    const server = await createCoreEngineServer();
    expect(server.config.HOST).toBeDefined();
    expect(server.app).toBeDefined();
    expect(server.migrationRunner).toBeDefined();
    await server.app.close();
  });

  it('returns service/package names', () => {
    expect(coreEngineServiceName()).toBe('core-engine');
  });
});