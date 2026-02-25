import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCoreEngineApp } from './server/app.js';
import { CommandDispatchWorker } from './server/command-dispatch-worker.js';
import { FileBackedCommandQueue } from './server/command-queue.js';
import { loadCoreEngineConfig } from './server/config.js';
import { InMemoryEventStream } from './server/event-stream.js';
import { createLogger } from './server/logger.js';
import {
  FileSystemMigrationSource,
  InMemoryMigrationStateStore,
  MigrationRunner,
  NoopSqlExecutor,
} from './server/migrations/index.js';
import { HttpOpenclawDispatcher } from './server/openclaw-dispatcher.js';
import { createDefaultReadinessChecks } from './server/readiness.js';

export function coreEngineServiceName(): string {
  return 'core-engine';
}

export async function createCoreEngineServer() {
  const config = loadCoreEngineConfig();
  const logger = createLogger({ service: coreEngineServiceName(), level: config.LOG_LEVEL });

  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = resolve(currentDirectory, './server/migrations/sql');

  const migrationSource = new FileSystemMigrationSource(migrationsDirectory);
  const migrationRunner = new MigrationRunner({
    source: migrationSource,
    sqlExecutor: new NoopSqlExecutor(),
    stateStore: new InMemoryMigrationStateStore(),
  });

  const eventStream = new InMemoryEventStream();
  const executorDispatcher = new HttpOpenclawDispatcher({
    baseUrl: config.OPENCLAW_EXECUTOR_URL,
    sharedToken: config.OPENCLAW_SHARED_TOKEN,
  });

  const commandQueue = new FileBackedCommandQueue(config.CORE_COMMAND_QUEUE_FILE);
  const commandDispatchWorker = new CommandDispatchWorker({
    queue: commandQueue,
    dispatcher: executorDispatcher,
    eventStream,
    logger,
    maxAttempts: config.CORE_DISPATCH_WORKER_MAX_ATTEMPTS,
  });

  const app = buildCoreEngineApp({
    config,
    logger,
    readinessChecks: createDefaultReadinessChecks(config, migrationSource),
    migrationRunner,
    eventStream,
    executorDispatcher,
    commandQueue,
    commandDispatchWorker,
  });

  return { app, config, logger, migrationRunner, commandDispatchWorker };
}

export async function startCoreEngineServer(): Promise<void> {
  const { app, config, logger, commandDispatchWorker } = await createCoreEngineServer();

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    commandDispatchWorker.start(config.CORE_DISPATCH_WORKER_INTERVAL_MS);
    logger.info('core-engine started', {
      host: config.HOST,
      port: config.PORT,
      env: config.NODE_ENV,
      dispatchWorkerIntervalMs: config.CORE_DISPATCH_WORKER_INTERVAL_MS,
    });
  } catch (error) {
    logger.error('core-engine failed to start', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exitCode = 1;
    throw error;
  }
}

const executedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (executedDirectly) {
  startCoreEngineServer();
}
