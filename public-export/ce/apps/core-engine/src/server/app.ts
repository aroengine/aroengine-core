import Fastify from 'fastify';

import { CoreEngineConfig } from './config.js';
import { CommandDispatchWorker } from './command-dispatch-worker.js';
import { CommandQueue } from './command-queue.js';
import { InMemoryEventStream } from './event-stream.js';
import { AroError, ERROR_CODES, toErrorResponse } from './errors.js';
import { ExecutorDispatcher } from './executor-contract.js';
import { Logger } from './logger.js';
import { MigrationRunner } from './migrations/index.js';
import { TokenBucketRateLimiter } from './phase5.js';
import { ReadinessCheck } from './readiness.js';
import { getCorrelationId, registerCommandRoutes, registerHealthRoutes } from './routes.js';

export interface CoreEngineAppDependencies {
  config: CoreEngineConfig;
  logger: Logger;
  readinessChecks: ReadinessCheck[];
  migrationRunner: MigrationRunner;
  eventStream: InMemoryEventStream;
  executorDispatcher: ExecutorDispatcher;
  commandQueue: CommandQueue;
  commandDispatchWorker: CommandDispatchWorker;
}

export function buildCoreEngineApp(dependencies: CoreEngineAppDependencies) {
  const app = Fastify({ logger: false });
  const apiRateLimiter = new TokenBucketRateLimiter(100, 60_000);
  const protectedServicePaths = [
    '/v1/commands',
    '/v1/events',
    '/v1/subscriptions',
    '/v1/webhooks/',
  ];

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/v1/')) {
      const sourceKey = request.headers['x-forwarded-for'];
      const key = typeof sourceKey === 'string' ? sourceKey : 'local';
      if (!apiRateLimiter.allow(key)) {
        const mapped = toErrorResponse(
          new AroError(
            ERROR_CODES.RATE_LIMIT_EXCEEDED,
            429,
            'Too many requests. Please retry after 60 seconds.',
            undefined,
            60,
          ),
        );
        await reply.status(mapped.statusCode).send(mapped.body);
        return;
      }
    }

    const requiresServiceAuth = protectedServicePaths.some((path) => request.url.startsWith(path));
    if (requiresServiceAuth) {
      const authorizationHeader = request.headers.authorization;
      const expectedToken = `Bearer ${dependencies.config.CORE_SERVICE_SHARED_TOKEN}`;
      if (authorizationHeader !== expectedToken) {
        const mapped = toErrorResponse(
          new AroError(ERROR_CODES.UNAUTHORIZED, 401, 'Invalid or missing service bearer token'),
        );
        await reply.status(mapped.statusCode).send(mapped.body);
        return;
      }

      const tenantHeader = request.headers['x-tenant-id'];
      if (typeof tenantHeader !== 'string' || tenantHeader.length === 0) {
        const mapped = toErrorResponse(
          new AroError(
            ERROR_CODES.VALIDATION_ERROR,
            400,
            'Missing required tenant boundary header: x-tenant-id',
          ),
        );
        await reply.status(mapped.statusCode).send(mapped.body);
        return;
      }
    }

    request.correlationId = getCorrelationId(request);
    reply.header('x-correlation-id', request.correlationId);
  });

  app.addHook('onResponse', async (request, reply) => {
    dependencies.logger.info('request complete', {
      correlationId: request.correlationId,
      method: request.method,
      path: request.url,
      statusCode: reply.statusCode,
    });
  });

  app.get('/v1/migrations/up', async () => {
    const result = await dependencies.migrationRunner.up();
    return { applied: result.applied };
  });

  app.get('/v1/migrations/down', async () => {
    const result = await dependencies.migrationRunner.down();
    return result;
  });

  app.register(async (instance) => {
    await registerHealthRoutes(instance, dependencies.readinessChecks);
    await registerCommandRoutes(instance, dependencies.logger, {
      eventStream: dependencies.eventStream,
      executorDispatcher: dependencies.executorDispatcher,
      commandQueue: dependencies.commandQueue,
      permissionManifestVersion: dependencies.config.OPENCLAW_PERMISSION_MANIFEST_VERSION,
    });
  });

  app.addHook('onClose', async () => {
    dependencies.commandDispatchWorker.stop();
  });

  app.setNotFoundHandler((_request, reply) => {
    const error = new AroError(ERROR_CODES.ROUTE_NOT_FOUND, 404, 'Route not found');
    const mapped = toErrorResponse(error);
    return reply.status(mapped.statusCode).send(mapped.body);
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = toErrorResponse(error);

    dependencies.logger.error('request failed', {
      correlationId: request.correlationId,
      method: request.method,
      path: request.url,
      statusCode: mapped.statusCode,
      code: mapped.body.error.code,
      message: mapped.body.error.message,
    });

    return reply.status(mapped.statusCode).send(mapped.body);
  });

  return app;
}