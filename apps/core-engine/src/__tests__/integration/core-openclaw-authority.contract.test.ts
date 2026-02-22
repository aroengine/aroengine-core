import { describe, expect, it } from 'vitest';

import { buildCoreEngineApp } from '../../server/app.js';
import { CommandDispatchWorker } from '../../server/command-dispatch-worker.js';
import { InMemoryCommandQueue } from '../../server/command-queue.js';
import { CoreEngineConfig } from '../../server/config.js';
import { InMemoryEventStream } from '../../server/event-stream.js';
import { CoreToExecutorCommand, ExecutorResultEvent } from '../../server/executor-contract.js';
import { createLogger } from '../../server/logger.js';
import {
  FileSystemMigrationSource,
  InMemoryMigrationStateStore,
  MigrationRunner,
  NoopSqlExecutor,
} from '../../server/migrations/index.js';
import { createDefaultReadinessChecks } from '../../server/readiness.js';

class RecordingExecutorDispatcher {
  public readonly seen: CoreToExecutorCommand[] = [];

  async dispatch(command: CoreToExecutorCommand): Promise<ExecutorResultEvent> {
    this.seen.push(command);
    return {
      eventId: '00000000-0000-4000-8000-000000009998',
      eventType: 'executor.command.succeeded',
      executionId: command.executionId,
      tenantId: command.tenantId,
      correlationId: command.correlationId,
      emittedAt: new Date().toISOString(),
      status: 'succeeded',
      payload: { acknowledgedCommandType: command.commandType },
    };
  }
}

const baseConfig: CoreEngineConfig = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3101,
  LOG_LEVEL: 'error',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/aro',
  DATABASE_MIGRATION_LOCK_TIMEOUT: 30000,
  OPENCLAW_EXECUTOR_URL: 'http://127.0.0.1:3200',
  OPENCLAW_SHARED_TOKEN: 'openclaw-shared-token-test',
  OPENCLAW_PERMISSION_MANIFEST_VERSION: '1.0.0',
  CORE_COMMAND_QUEUE_FILE: '/tmp/aro-contract-command-queue.json',
  CORE_DISPATCH_WORKER_INTERVAL_MS: 5000,
  CORE_DISPATCH_WORKER_MAX_ATTEMPTS: 3,
};

async function createApp() {
  const migrationSource = new FileSystemMigrationSource(
    new URL('../../server/migrations/sql', import.meta.url).pathname,
  );
  const eventStream = new InMemoryEventStream();
  const dispatcher = new RecordingExecutorDispatcher();
  const commandQueue = new InMemoryCommandQueue();
  const logger = createLogger({ service: 'core-engine', level: 'error' });
  const commandDispatchWorker = new CommandDispatchWorker({
    queue: commandQueue,
    dispatcher,
    eventStream,
    logger,
    maxAttempts: baseConfig.CORE_DISPATCH_WORKER_MAX_ATTEMPTS,
  });

  const app = buildCoreEngineApp({
    config: baseConfig,
    logger,
    migrationRunner: new MigrationRunner({
      source: migrationSource,
      sqlExecutor: new NoopSqlExecutor(),
      stateStore: new InMemoryMigrationStateStore(),
    }),
    readinessChecks: createDefaultReadinessChecks(baseConfig, migrationSource),
    eventStream,
    executorDispatcher: dispatcher,
    commandQueue,
    commandDispatchWorker,
  });

  await app.ready();
  return { app, eventStream, dispatcher, commandDispatchWorker };
}

describe('core-engine openclaw authority contract', () => {
  it('dispatches integration side effects only through /v1/commands core path', async () => {
    const { app, dispatcher, commandDispatchWorker } = await createApp();

    const bypassAttempt = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      payload: {
        executionId: '00000000-0000-4000-8000-000000000111',
        tenantId: 'tenant-1',
        correlationId: 'corr-1',
        commandType: 'integration.twilio.send_sms',
        authorizedByCore: true,
        permissionManifestVersion: '1.0.0',
        payload: { to: '+15551234567' },
      },
    });

    expect(bypassAttempt.statusCode).toBe(404);
    expect(dispatcher.seen).toHaveLength(0);

    const missingHeaders = await app.inject({
      method: 'POST',
      url: '/v1/commands',
      payload: {
        commandType: 'integration.twilio.send_sms',
        payload: { to: '+15551234567' },
      },
    });

    expect(missingHeaders.statusCode).toBe(400);
    expect(dispatcher.seen).toHaveLength(0);

    const nonIntegrationCommand = await app.inject({
      method: 'POST',
      url: '/v1/commands',
      headers: {
        'x-tenant-id': 'tenant-1',
        'idempotency-key': 'idem-non-int-1',
        'x-correlation-id': 'corr-non-int-1',
      },
      payload: {
        commandType: 'appointment.schedule_reminders',
        payload: { appointmentId: 'apt-1' },
      },
    });

    expect(nonIntegrationCommand.statusCode).toBe(202);
    expect(dispatcher.seen).toHaveLength(0);

    const integrationCommand = await app.inject({
      method: 'POST',
      url: '/v1/commands',
      headers: {
        'x-tenant-id': 'tenant-1',
        'idempotency-key': 'idem-int-1',
        'x-correlation-id': 'corr-int-1',
      },
      payload: {
        commandType: 'integration.twilio.send_sms',
        payload: { to: '+15551234567' },
      },
    });

    expect(integrationCommand.statusCode).toBe(202);
    // Command is enqueued — dispatcher has NOT been called yet.
    expect(dispatcher.seen).toHaveLength(0);

    // Flush the worker: the enqueued command is now dispatched to the executor.
    await commandDispatchWorker.tick();

    expect(dispatcher.seen).toHaveLength(1);
    expect(dispatcher.seen[0]?.authorizedByCore).toBe(true);
    expect(dispatcher.seen[0]?.commandType).toBe('integration.twilio.send_sms');

    const events = await app.inject({
      method: 'GET',
      url: '/v1/events?tenantId=tenant-1&after=0&limit=20',
    });
    expect(events.statusCode).toBe(200);

    const eventTypes = (events.json().events as Array<{ eventType: string }>).map((event) => event.eventType);
    expect(eventTypes).toContain('command.accepted');
    expect(eventTypes).toContain('executor.command.succeeded');

    await app.close();
  });
});
