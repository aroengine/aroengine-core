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

class FakeExecutorDispatcher {
  public readonly seen: CoreToExecutorCommand[] = [];

  async dispatch(command: CoreToExecutorCommand): Promise<ExecutorResultEvent> {
    this.seen.push(command);
    const responsePayload =
      command.commandType === 'integration.nlp.classify_reply'
        ? {
            acknowledgedCommandType: command.commandType,
            openclawOutput: {
              intent:
                typeof command.payload['text'] === 'string' &&
                (command.payload['text'] as string).toLowerCase().includes('reschedule')
                  ? 'reschedule'
                  : 'confirm',
            },
          }
        : {
            acknowledgedCommandType: command.commandType,
            openclawOutput: {
              messageId: `msg-${command.executionId}`,
            },
          };

    return {
      eventId: '00000000-0000-4000-8000-000000009999',
      eventType: 'executor.command.succeeded',
      executionId: command.executionId,
      tenantId: command.tenantId,
      correlationId: command.correlationId,
      emittedAt: new Date().toISOString(),
      status: 'succeeded',
      payload: responsePayload,
    };
  }
}

const baseConfig: CoreEngineConfig = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3100,
  LOG_LEVEL: 'error',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/aro',
  DATABASE_MIGRATION_LOCK_TIMEOUT: 30000,
  OPENCLAW_EXECUTOR_URL: 'http://127.0.0.1:3200',
  OPENCLAW_SHARED_TOKEN: 'openclaw-shared-token-test',
  CORE_SERVICE_SHARED_TOKEN: 'core-service-shared-token-test',
  OPENCLAW_PERMISSION_MANIFEST_VERSION: '1.0.0',
  CORE_COMMAND_QUEUE_FILE: '/tmp/aro-test-command-queue.json',
  CORE_DISPATCH_WORKER_INTERVAL_MS: 5000,
  CORE_DISPATCH_WORKER_MAX_ATTEMPTS: 3,
};

async function createApp(overrides?: Partial<CoreEngineConfig>) {
  const config = { ...baseConfig, ...overrides };
  const migrationSource = new FileSystemMigrationSource(
    new URL('../../server/migrations/sql', import.meta.url).pathname,
  );
  const fakeDispatcher = new FakeExecutorDispatcher();
  const eventStream = new InMemoryEventStream();
  const commandQueue = new InMemoryCommandQueue();
  const logger = createLogger({ service: 'core-engine', level: 'error' });
  const commandDispatchWorker = new CommandDispatchWorker({
    queue: commandQueue,
    dispatcher: fakeDispatcher,
    eventStream,
    logger,
    maxAttempts: config.CORE_DISPATCH_WORKER_MAX_ATTEMPTS,
  });

  const app = buildCoreEngineApp({
    config,
    logger,
    migrationRunner: new MigrationRunner({
      source: migrationSource,
      sqlExecutor: new NoopSqlExecutor(),
      stateStore: new InMemoryMigrationStateStore(),
    }),
    readinessChecks: createDefaultReadinessChecks(config, migrationSource),
    eventStream,
    executorDispatcher: fakeDispatcher,
    commandQueue,
    commandDispatchWorker,
  });

  await app.ready();
  return { app, fakeDispatcher, commandDispatchWorker };
}

describe('core-engine integration', () => {
  it('serves health endpoint', async () => {
    const { app } = await createApp();

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('healthy');

    await app.close();
  });

  it('serves readiness endpoint with up checks', async () => {
    const { app } = await createApp();

    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ready');

    await app.close();
  });

  it('reports not ready when database contract is invalid', async () => {
    const { app } = await createApp({ DATABASE_URL: 'invalid-db-url' });

    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('not_ready');

    await app.close();
  });

  it('returns validation envelope for invalid command request', async () => {
    const { app } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/commands',
      headers: {
        authorization: `Bearer ${baseConfig.CORE_SERVICE_SHARED_TOKEN}`,
        'x-tenant-id': 'tenant-health-1',
      },
      payload: { commandType: 'test.command', payload: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('echoes provided correlation ID header', async () => {
    const { app } = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-correlation-id': 'corr-test-123',
      },
    });

    expect(response.headers['x-correlation-id']).toBe('corr-test-123');

    await app.close();
  });

  it('runs migration up and down endpoints', async () => {
    const { app } = await createApp();

    const upResponse = await app.inject({ method: 'GET', url: '/v1/migrations/up' });
    expect(upResponse.statusCode).toBe(200);
    expect(upResponse.json().applied).toContain('0001_core_engine_baseline');
    expect(upResponse.json().applied).toContain('0002_phase2_data_layer');

    const downResponse = await app.inject({ method: 'GET', url: '/v1/migrations/down' });
    expect(downResponse.statusCode).toBe(200);
    expect(downResponse.json().rolledBack).toBe('0002_phase2_data_layer');

    await app.close();
  });

  it('serves internal admin API endpoints', async () => {
    const { app, commandDispatchWorker } = await createApp();
    const serviceHeaders = {
      authorization: `Bearer ${baseConfig.CORE_SERVICE_SHARED_TOKEN}`,
      'x-tenant-id': 'tenant-health-1',
    };

    const appointments = await app.inject({ method: 'GET', url: '/v1/admin/appointments' });
    expect(appointments.statusCode).toBe(200);

    const metrics = await app.inject({ method: 'GET', url: '/v1/admin/metrics' });
    expect(metrics.statusCode).toBe(200);

    const override = await app.inject({
      method: 'POST',
      url: '/v1/admin/manual-overrides',
      payload: {
        action: 'retry_workflow',
        appointmentId: 'apt-123',
        reason: 'Operator requested retry',
      },
    });
    expect(override.statusCode).toBe(202);

    const tokenResponse = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/token',
      payload: { username: 'admin', password: 'admin-pass' },
    });
    expect(tokenResponse.statusCode).toBe(200);
    const token = tokenResponse.json().token as string;

    const auditLogs = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit/logs',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(auditLogs.statusCode).toBe(200);

    const consent = await app.inject({
      method: 'POST',
      url: '/v1/privacy/consent',
      payload: { customerId: 'cust-1' },
    });
    expect(consent.statusCode).toBe(200);

    const optOut = await app.inject({
      method: 'POST',
      url: '/v1/privacy/opt-out',
      payload: { customerId: 'cust-1' },
    });
    expect(optOut.statusCode).toBe(200);

    const exportResponse = await app.inject({
      method: 'GET',
      url: '/v1/privacy/export/cust-1',
    });
    expect(exportResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/privacy/delete/cust-1',
    });
    expect(deleteResponse.statusCode).toBe(204);

    const bookingWebhook = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/booking',
      headers: serviceHeaders,
      payload: {
        tenantId: 'tenant-health-1',
        externalId: 'cal_evt_100',
        customerPhone: '+15551234567',
        appointmentDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        serviceType: 'Consultation',
      },
    });
    expect(bookingWebhook.statusCode).toBe(202);
    expect(bookingWebhook.json().dispatchedCommands[0].commandType).toBe('integration.twilio.send_sms');
    expect(bookingWebhook.json().dispatchedCommands[0].dispatchStatus).toBe('enqueued');
    expect(bookingWebhook.json().appointment.status).toBe('pending_confirm');

    // Flush the worker: deliver the enqueued SMS command and emit message_sent.
    await commandDispatchWorker.tick();

    const inboundReply = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound-reply',
      headers: serviceHeaders,
      payload: {
        tenantId: 'tenant-health-1',
        messageId: 'msg_123',
        text: 'please reschedule me',
      },
    });
    expect(inboundReply.statusCode).toBe(202);
    expect(inboundReply.json().intent).toBe('reschedule');

    const classify = await app.inject({
      method: 'POST',
      url: '/v1/messages/classify',
      payload: { message: 'Yes I confirm' },
    });
    expect(classify.statusCode).toBe(200);
    expect(classify.json().intent).toBe('confirmed');

    const appointmentId = bookingWebhook.json().appointment.id as string;
    const reviewRequest = await app.inject({
      method: 'POST',
      url: '/v1/workflows/review-request',
      payload: { appointmentId },
    });
    expect(reviewRequest.statusCode).toBe(200);

    const dashboardAppointments = await app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard/appointments',
    });
    expect(dashboardAppointments.statusCode).toBe(200);

    const dashboardMetrics = await app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard/metrics',
    });
    expect(dashboardMetrics.statusCode).toBe(200);

    const integratedCommand = await app.inject({
      method: 'POST',
      url: '/v1/commands',
      headers: {
        'x-tenant-id': 'tenant-health-1',
        'idempotency-key': 'idem-1',
        'x-correlation-id': 'corr-1',
        authorization: `Bearer ${baseConfig.CORE_SERVICE_SHARED_TOKEN}`,
      },
      payload: {
        commandType: 'integration.twilio.send_sms',
        payload: { to: '+15551234567' },
      },
    });
    expect(integratedCommand.statusCode).toBe(202);
    expect(integratedCommand.json().dispatchStatus).toBe('enqueued');

    // Flush worker once more to deliver the /v1/commands enqueued SMS command.
    await commandDispatchWorker.tick();

    const events = await app.inject({
      method: 'GET',
      url: '/v1/events?tenantId=tenant-health-1&after=0&limit=50',
      headers: serviceHeaders,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().events.length).toBeGreaterThan(0);
    const eventTypes = (events.json().events as Array<{ eventType: string }>).map((item) => item.eventType);
    expect(eventTypes).toContain('booking.received');
    expect(eventTypes).toContain('message_sent');
    expect(eventTypes).toContain('reply_classified');

    const subscription = await app.inject({
      method: 'POST',
      url: '/v1/subscriptions',
      headers: serviceHeaders,
      payload: {
        tenantId: 'tenant-health-1',
        callbackUrl: 'https://example.com/event-hook',
      },
    });
    expect(subscription.statusCode).toBe(201);

    const replay = await app.inject({
      method: 'POST',
      url: `/v1/subscriptions/${subscription.json().id}/replay`,
      headers: serviceHeaders,
      payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().count).toBeGreaterThan(0);

    await app.close();
  });
});