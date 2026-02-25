import type { ExecutorDispatcher } from './executor-contract.js';
import type { InMemoryEventStream } from './event-stream.js';
import type { Logger } from './logger.js';
import type { CommandQueue } from './command-queue.js';

export interface CommandDispatchWorkerOptions {
  queue: CommandQueue;
  dispatcher: ExecutorDispatcher;
  eventStream: InMemoryEventStream;
  logger: Logger;
  maxAttempts?: number;
}

export class CommandDispatchWorker {
  private readonly queue: CommandQueue;
  private readonly dispatcher: ExecutorDispatcher;
  private readonly eventStream: InMemoryEventStream;
  private readonly logger: Logger;
  private readonly maxAttempts: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: CommandDispatchWorkerOptions) {
    this.queue = options.queue;
    this.dispatcher = options.dispatcher;
    this.eventStream = options.eventStream;
    this.logger = options.logger;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async tick(): Promise<void> {
    const pending = this.queue.listPending().filter((entry) => entry.attempts < this.maxAttempts);

    for (const entry of pending) {
      const { command } = entry;
      // Capture attempt count before markAttempted mutates the entry in-place.
      const prevAttempts = entry.attempts;

      this.queue.markAttempted(command.executionId, '');

      try {
        const result = await this.dispatcher.dispatch(command);

        this.queue.markDelivered(command.executionId);

        this.eventStream.append({
          eventType: result.eventType,
          tenantId: result.tenantId,
          correlationId: result.correlationId,
          payload: {
            executionId: result.executionId,
            status: result.status,
            ...result.payload,
          },
        });

        if (command.commandType === 'integration.twilio.send_sms' && result.status === 'succeeded') {
          const output = result.payload['openclawOutput'];
          const outputObject =
            typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : undefined;
          const messageIdCandidate = outputObject?.['messageId'];
          const messageId =
            typeof messageIdCandidate === 'string' && messageIdCandidate.length > 0
              ? messageIdCandidate
              : result.executionId;

          this.eventStream.append({
            eventType: 'message_sent',
            tenantId: result.tenantId,
            correlationId: result.correlationId,
            payload: {
              executionId: result.executionId,
              messageId,
              commandType: command.commandType,
            },
          });
        }

        this.logger.info('command dispatched', {
          executionId: command.executionId,
          commandType: command.commandType,
          tenantId: command.tenantId,
          status: result.status,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown dispatch error';
        const nextAttempts = prevAttempts + 1;

        this.logger.warn('command dispatch failed', {
          executionId: command.executionId,
          commandType: command.commandType,
          tenantId: command.tenantId,
          attempt: nextAttempts,
          reason,
        });

        if (nextAttempts >= this.maxAttempts) {
          this.queue.markDlq(command.executionId, reason);

          this.eventStream.append({
            eventType: 'command.dispatch.dlq',
            tenantId: command.tenantId,
            correlationId: command.correlationId,
            payload: {
              commandType: command.commandType,
              executionId: command.executionId,
              attempts: nextAttempts,
              reason,
            },
          });
        }
      }
    }
  }

  start(intervalMs: number): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
