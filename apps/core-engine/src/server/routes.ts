import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { CommandQueue } from './command-queue.js';
import { InMemoryEventStream } from './event-stream.js';
import { AroError, ERROR_CODES } from './errors.js';
import { CoreToExecutorCommand, ExecutorDispatcher } from './executor-contract.js';
import { Logger } from './logger.js';
import { AdminAuthService, AuditLogService, PrivacyService } from './phase5.js';
import { MvpWorkflowService } from './phase6.js';
import type { ReadinessCheck } from './readiness.js';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

export function getCorrelationId(request: FastifyRequest): string {
  const headerValue = request.headers['x-correlation-id'];
  if (typeof headerValue === 'string' && headerValue.length > 0) {
    return headerValue;
  }

  return randomUUID();
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  readinessChecks: ReadinessCheck[],
): Promise<void> {
  const healthHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    const memoryUsage = process.memoryUsage();
    const response = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'core-engine',
      metrics: {
        uptime: process.uptime(),
        memoryUsage: {
          rss: memoryUsage.rss,
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
        },
      },
    };

    return reply.status(200).send(response);
  };

  const readyHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    const checks = await Promise.all(
      readinessChecks.map(async (check) => ({ name: check.name, status: await check.run() })),
    );

    const services = Object.fromEntries(checks.map((check) => [check.name, check.status]));
    const allChecksUp = checks.every((check) => check.status === 'up');

    return reply.status(allChecksUp ? 200 : 503).send({
      status: allChecksUp ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      services,
    });
  };

  app.get('/health', healthHandler);
  app.get('/ready', readyHandler);
  app.get('/api/v1/health', healthHandler);
  app.get('/api/v1/ready', readyHandler);
}

const commandHeadersSchema = z.object({
  'x-tenant-id': z.string().min(1),
  'idempotency-key': z.string().min(1),
  'x-correlation-id': z.string().min(1),
});

const commandBodySchema = z.object({
  commandType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

const listEventsQuerySchema = z.object({
  tenantId: z.string().min(1).optional(),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const createSubscriptionBodySchema = z.object({
  tenantId: z.string().min(1),
  callbackUrl: z.string().url().optional(),
});

const replayBodySchema = z.object({
  after: z.string().optional(),
});

const bookingWebhookSchema = z.object({
  tenantId: z.string().min(1).optional(),
  externalId: z.string().min(1),
  customerPhone: z.string().min(1),
  appointmentDate: z.string().datetime(),
  serviceType: z.string().min(1),
});

const inboundReplyWebhookSchema = z.object({
  tenantId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  text: z.string().min(1),
  appointmentId: z.string().min(1).optional(),
});

interface CommandRouteDependencies {
  eventStream: InMemoryEventStream;
  executorDispatcher: ExecutorDispatcher;
  commandQueue: CommandQueue;
  permissionManifestVersion: string;
}

export async function registerCommandRoutes(
  app: FastifyInstance,
  logger: Logger,
  dependencies: CommandRouteDependencies,
): Promise<void> {
  const auth = new AdminAuthService('dev-secret', 'admin', 'admin-pass');
  const audit = new AuditLogService();
  const privacy = new PrivacyService();
  const mvp = new MvpWorkflowService();

  // Enqueue an integration command for async delivery by the worker.
  // Returns immediately — the worker calls the executor in the background.
  const enqueueCommand = (input: {
    tenantId: string;
    correlationId: string;
    commandType: string;
    payload: Record<string, unknown>;
  }): { command: CoreToExecutorCommand; status: 'enqueued' } => {
    const executorCommand: CoreToExecutorCommand = {
      executionId: randomUUID(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      commandType: input.commandType,
      authorizedByCore: true,
      permissionManifestVersion: dependencies.permissionManifestVersion,
      payload: input.payload,
    };

    dependencies.commandQueue.enqueue(executorCommand);

    dependencies.eventStream.append({
      eventType: 'command.accepted',
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      payload: {
        commandType: input.commandType,
        executionId: executorCommand.executionId,
      },
    });

    return { command: executorCommand, status: 'enqueued' };
  };

  // Dispatch an integration command synchronously (blocking HTTP call to executor).
  // Used only for in-step skill invocations that require an immediate result (e.g. NLP classify).
  const dispatchCommandSync = async (input: {
    tenantId: string;
    correlationId: string;
    commandType: string;
    payload: Record<string, unknown>;
  }): Promise<{
    command: CoreToExecutorCommand;
    result?: Awaited<ReturnType<ExecutorDispatcher['dispatch']>>;
    status: 'succeeded' | 'dlq';
  }> => {
    const executorCommand: CoreToExecutorCommand = {
      executionId: randomUUID(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      commandType: input.commandType,
      authorizedByCore: true,
      permissionManifestVersion: dependencies.permissionManifestVersion,
      payload: input.payload,
    };

    dependencies.eventStream.append({
      eventType: 'command.accepted',
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      payload: {
        commandType: input.commandType,
        executionId: executorCommand.executionId,
      },
    });

    try {
      const result = await dependencies.executorDispatcher.dispatch(executorCommand);

      dependencies.eventStream.append({
        eventType: result.eventType,
        tenantId: result.tenantId,
        correlationId: result.correlationId,
        payload: {
          executionId: result.executionId,
          status: result.status,
          ...result.payload,
        },
      });

      return { command: executorCommand, result, status: 'succeeded' };
    } catch (error) {
      dependencies.eventStream.append({
        eventType: 'command.dispatch.dlq',
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        payload: {
          commandType: input.commandType,
          executionId: executorCommand.executionId,
          attempts: 1,
          reason: error instanceof Error ? error.message : 'Unknown dispatch error',
        },
      });

      return { command: executorCommand, status: 'dlq' };
    }
  };

  app.post('/v1/commands', async (request, reply) => {
    const headers = commandHeadersSchema.parse(request.headers);
    const body = commandBodySchema.parse(request.body);

    logger.info('command accepted', {
      commandType: body.commandType,
      tenantId: headers['x-tenant-id'],
      correlationId: request.correlationId,
      path: request.url,
      method: request.method,
    });

    audit.append('command.accepted', 'system', {
      commandType: body.commandType,
      tenantId: headers['x-tenant-id'],
    });

    dependencies.eventStream.append({
      eventType: 'command.accepted',
      tenantId: headers['x-tenant-id'],
      correlationId: request.correlationId,
      payload: {
        commandType: body.commandType,
        idempotencyKey: headers['idempotency-key'],
      },
    });

    if (body.commandType.startsWith('integration.')) {
      const enqueued = enqueueCommand({
        tenantId: headers['x-tenant-id'],
        correlationId: request.correlationId,
        commandType: body.commandType,
        payload: body.payload,
      });

      return reply.status(202).send({
        status: 'accepted',
        correlationId: headers['x-correlation-id'],
        commandType: body.commandType,
        executionId: enqueued.command.executionId,
        dispatchStatus: enqueued.status,
      });
    }

    return reply.status(202).send({
      status: 'accepted',
      correlationId: headers['x-correlation-id'],
      commandType: body.commandType,
    });
  });

  app.get('/v1/error-test', async () => {
    throw new AroError(ERROR_CODES.SERVICE_UNAVAILABLE, 503, 'dependency unavailable', undefined, 30);
  });

  app.get('/v1/events', async (request, reply) => {
    const query = listEventsQuerySchema.parse(request.query);
    const options: { tenantId?: string; after?: string; limit?: number } = {
      ...(query.tenantId === undefined ? {} : { tenantId: query.tenantId }),
      ...(query.after === undefined ? {} : { after: query.after }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    };
    const events = dependencies.eventStream.list(options);

    return reply.status(200).send({
      events,
      nextCursor: events.length > 0 ? events[events.length - 1]?.replayCursor : query.after ?? '0',
    });
  });

  app.post('/v1/subscriptions', async (request, reply) => {
    const payload = createSubscriptionBodySchema.parse(request.body);
    const subscription = dependencies.eventStream.createSubscription(payload.tenantId, payload.callbackUrl);
    return reply.status(201).send(subscription);
  });

  app.post('/v1/subscriptions/:id/replay', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const payload = replayBodySchema.parse(request.body ?? {});
    const events = dependencies.eventStream.replaySubscription(params.id, payload.after);

    return reply.status(200).send({
      events,
      count: events.length,
    });
  });

  app.get('/v1/admin/appointments', async (_request, reply) => {
    return reply.status(200).send({
      data: [],
      meta: {
        total: 0,
      },
    });
  });

  app.get('/v1/admin/metrics', async (_request, reply) => {
    return reply.status(200).send({
      remindersSent: 0,
      confirmationsReceived: 0,
      noShowRate: 0,
    });
  });

  app.post('/v1/admin/manual-overrides', async (request, reply) => {
    const schema = z.object({
      action: z.enum(['mark_confirmed', 'mark_cancelled', 'retry_workflow']),
      appointmentId: z.string().min(1),
      reason: z.string().min(1),
    });

    const payload = schema.parse(request.body);

    logger.warn('manual override requested', {
      action: payload.action,
      appointmentId: payload.appointmentId,
      correlationId: request.correlationId,
      path: request.url,
      method: request.method,
    });

    audit.append('admin.manual_override', 'admin', payload);

    return reply.status(202).send({
      status: 'accepted',
      override: payload,
    });
  });

  app.post('/v1/admin/auth/token', async (request, reply) => {
    const schema = z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    });
    const payload = schema.parse(request.body);
    const token = auth.issueToken(payload.username, payload.password);
    if (token === null) {
      throw new AroError(ERROR_CODES.UNAUTHORIZED, 401, 'Invalid credentials');
    }

    return reply.status(200).send({ token });
  });

  app.get('/v1/admin/audit/logs', async (request, reply) => {
    const token = request.headers.authorization;
    if (typeof token !== 'string' || !token.startsWith('Bearer ')) {
      throw new AroError(ERROR_CODES.UNAUTHORIZED, 401, 'Missing bearer token');
    }

    const rawToken = token.replace('Bearer ', '');
    if (!auth.verifyToken(rawToken)) {
      throw new AroError(ERROR_CODES.UNAUTHORIZED, 401, 'Invalid bearer token');
    }

    return reply.status(200).send({
      logs: audit.list(),
      integrity: audit.verifyIntegrity(),
    });
  });

  app.post('/v1/privacy/consent', async (request, reply) => {
    const schema = z.object({ customerId: z.string().min(1) });
    const payload = schema.parse(request.body);
    const record = privacy.grantConsent(payload.customerId);
    audit.append('privacy.consent_granted', 'system', payload);
    return reply.status(200).send(record);
  });

  app.post('/v1/privacy/opt-out', async (request, reply) => {
    const schema = z.object({ customerId: z.string().min(1) });
    const payload = schema.parse(request.body);
    const record = privacy.optOut(payload.customerId);
    audit.append('privacy.opt_out', 'system', payload);
    return reply.status(200).send(record);
  });

  app.get('/v1/privacy/export/:customerId', async (request, reply) => {
    const paramsSchema = z.object({ customerId: z.string().min(1) });
    const params = paramsSchema.parse(request.params);
    return reply.status(200).send(privacy.exportCustomer(params.customerId));
  });

  app.delete('/v1/privacy/delete/:customerId', async (request, reply) => {
    const paramsSchema = z.object({ customerId: z.string().min(1) });
    const params = paramsSchema.parse(request.params);
    privacy.deleteCustomer(params.customerId);
    audit.append('privacy.deleted', 'system', params);
    return reply.status(204).send();
  });

  app.post('/v1/webhooks/booking', async (request, reply) => {
    const payload = bookingWebhookSchema.parse(request.body);
    const tenantId = payload.tenantId ?? 'tenant-default';
    const appointment = mvp.ingestBookingEvent({
      externalId: payload.externalId,
      customerPhone: payload.customerPhone,
      appointmentDate: payload.appointmentDate,
      serviceType: payload.serviceType,
    });
    const reminders = mvp.computeReminderSchedule(appointment.id);

    dependencies.eventStream.append({
      eventType: 'booking.received',
      tenantId,
      correlationId: request.correlationId,
      payload: {
        externalId: payload.externalId,
        appointmentId: appointment.id,
        serviceType: appointment.serviceType,
      },
    });

    const enqueued = enqueueCommand({
      tenantId,
      correlationId: request.correlationId,
      commandType: 'integration.twilio.send_sms',
      payload: {
        appointmentId: appointment.id,
        customerPhone: appointment.customerPhone,
        templateId: 'reminder_48h',
        reminderAt: reminders.reminder48hAt,
      },
    });

    return reply.status(202).send({
      appointment,
      reminders,
      dispatchedCommands: [
        {
          commandType: enqueued.command.commandType,
          executionId: enqueued.command.executionId,
          dispatchStatus: enqueued.status,
        },
      ],
    });
  });

  app.post('/v1/webhooks/inbound-reply', async (request, reply) => {
    const payload = inboundReplyWebhookSchema.parse(request.body);
    const tenantId = payload.tenantId ?? 'tenant-default';

    dependencies.eventStream.append({
      eventType: 'inbound.reply.received',
      tenantId,
      correlationId: request.correlationId,
      payload: {
        messageId: payload.messageId,
        text: payload.text,
        appointmentId: payload.appointmentId,
      },
    });

    // NLP classification is synchronous: the result is needed immediately to apply policy.
    const classificationCommand = await dispatchCommandSync({
      tenantId,
      correlationId: request.correlationId,
      commandType: 'integration.nlp.classify_reply',
      payload: {
        messageId: payload.messageId,
        text: payload.text,
        appointmentId: payload.appointmentId,
      },
    });

    const output = classificationCommand.result?.payload['openclawOutput'];
    const intent =
      typeof output === 'object' &&
      output !== null &&
      'intent' in output &&
      typeof (output as Record<string, unknown>)['intent'] === 'string'
        ? ((output as Record<string, unknown>)['intent'] as string)
        : 'unclear';

    dependencies.eventStream.append({
      eventType: 'reply_classified',
      tenantId,
      correlationId: request.correlationId,
      payload: {
        messageId: payload.messageId,
        appointmentId: payload.appointmentId,
        intent,
      },
    });

    const normalizedIntent = intent.toLowerCase();
    if (normalizedIntent === 'confirm' || normalizedIntent === 'confirmed') {
      dependencies.eventStream.append({
        eventType: 'appointment.confirmed',
        tenantId,
        correlationId: request.correlationId,
        payload: {
          messageId: payload.messageId,
          appointmentId: payload.appointmentId,
        },
      });
    }

    if (normalizedIntent === 'reschedule') {
      // Reschedule link delivery is async — enqueued for worker dispatch.
      enqueueCommand({
        tenantId,
        correlationId: request.correlationId,
        commandType: 'integration.booking.request_reschedule_link',
        payload: {
          messageId: payload.messageId,
          appointmentId: payload.appointmentId,
        },
      });
    }

    if (normalizedIntent === 'cancel') {
      dependencies.eventStream.append({
        eventType: 'appointment.cancel_requested',
        tenantId,
        correlationId: request.correlationId,
        payload: {
          messageId: payload.messageId,
          appointmentId: payload.appointmentId,
        },
      });
    }

    return reply.status(202).send({
      status: 'accepted',
      messageId: payload.messageId,
      intent,
      executionId: classificationCommand.command.executionId,
      dispatchStatus: classificationCommand.status,
    });
  });

  app.post('/v1/messages/classify', async (request, reply) => {
    const schema = z.object({ message: z.string().min(1) });
    const payload = schema.parse(request.body);
    return reply.status(200).send(mvp.classifyResponse(payload.message));
  });

  app.post('/v1/workflows/review-request', async (request, reply) => {
    const schema = z.object({ appointmentId: z.string().min(1) });
    const payload = schema.parse(request.body);
    return reply.status(200).send(mvp.scheduleReviewRequest(payload.appointmentId));
  });

  app.get('/v1/admin/dashboard/appointments', async (_request, reply) => {
    return reply.status(200).send({
      appointments: mvp.listAppointments(),
    });
  });

  app.get('/v1/admin/dashboard/metrics', async (_request, reply) => {
    return reply.status(200).send(mvp.metrics());
  });
}
