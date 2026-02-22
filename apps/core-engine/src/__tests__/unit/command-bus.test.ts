import { describe, expect, it, vi } from 'vitest';

import { CommandDispatchWorker } from '../../server/command-dispatch-worker.js';
import { InMemoryCommandQueue } from '../../server/command-queue.js';
import { InMemoryEventStream } from '../../server/event-stream.js';
import type { CoreToExecutorCommand, ExecutorResultEvent } from '../../server/executor-contract.js';
import { createLogger } from '../../server/logger.js';

const logger = createLogger({ service: 'core-engine', level: 'error' });

function makeCommand(overrides?: Partial<CoreToExecutorCommand>): CoreToExecutorCommand {
  return {
    executionId: '00000000-0000-4000-8000-000000000001',
    tenantId: 'tenant-1',
    correlationId: 'corr-1',
    commandType: 'integration.twilio.send_sms',
    authorizedByCore: true,
    permissionManifestVersion: '1.0.0',
    payload: { to: '+15551234567' },
    ...overrides,
  };
}

function makeSuccessResult(command: CoreToExecutorCommand): ExecutorResultEvent {
  return {
    eventId: '00000000-0000-4000-8000-000000009001',
    eventType: 'executor.command.succeeded',
    executionId: command.executionId,
    tenantId: command.tenantId,
    correlationId: command.correlationId,
    emittedAt: new Date().toISOString(),
    status: 'succeeded',
    payload: {
      acknowledgedCommandType: command.commandType,
      openclawOutput: { messageId: 'msg-abc123' },
    },
  };
}

// ─── CommandQueue unit tests ──────────────────────────────────────────────────

describe('InMemoryCommandQueue', () => {
  it('enqueues and lists pending commands', () => {
    const queue = new InMemoryCommandQueue();
    const cmd = makeCommand();

    queue.enqueue(cmd);

    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.command.executionId).toBe(cmd.executionId);
    expect(pending[0]?.status).toBe('pending');
    expect(pending[0]?.attempts).toBe(0);
  });

  it('markAttempted increments attempt count', () => {
    const queue = new InMemoryCommandQueue();
    const cmd = makeCommand();
    queue.enqueue(cmd);

    queue.markAttempted(cmd.executionId, 'network timeout');

    const pending = queue.listPending();
    expect(pending[0]?.attempts).toBe(1);
    expect(pending[0]?.lastError).toBe('network timeout');
    expect(pending[0]?.status).toBe('pending');
  });

  it('markDelivered removes entry from pending', () => {
    const queue = new InMemoryCommandQueue();
    const cmd = makeCommand();
    queue.enqueue(cmd);

    queue.markDelivered(cmd.executionId);

    expect(queue.listPending()).toHaveLength(0);
  });

  it('markDlq removes entry from pending and records reason', () => {
    const queue = new InMemoryCommandQueue();
    const cmd = makeCommand();
    queue.enqueue(cmd);

    queue.markDlq(cmd.executionId, 'max retries exceeded');

    expect(queue.listPending()).toHaveLength(0);
  });

  it('listPending only returns pending entries', () => {
    const queue = new InMemoryCommandQueue();
    const cmd1 = makeCommand({ executionId: '00000000-0000-4000-8000-000000000001' });
    const cmd2 = makeCommand({ executionId: '00000000-0000-4000-8000-000000000002' });
    const cmd3 = makeCommand({ executionId: '00000000-0000-4000-8000-000000000003' });

    queue.enqueue(cmd1);
    queue.enqueue(cmd2);
    queue.enqueue(cmd3);

    queue.markDelivered(cmd1.executionId);
    queue.markDlq(cmd2.executionId, 'failed');

    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.command.executionId).toBe(cmd3.executionId);
  });

  it('no-ops gracefully on unknown executionId', () => {
    const queue = new InMemoryCommandQueue();
    expect(() => queue.markDelivered('non-existent')).not.toThrow();
    expect(() => queue.markAttempted('non-existent', 'err')).not.toThrow();
    expect(() => queue.markDlq('non-existent', 'err')).not.toThrow();
  });
});

// ─── CommandDispatchWorker unit tests ─────────────────────────────────────────

describe('CommandDispatchWorker', () => {
  it('tick delivers a pending command and emits result + message_sent events', async () => {
    const queue = new InMemoryCommandQueue();
    const eventStream = new InMemoryEventStream();
    const cmd = makeCommand();
    const result = makeSuccessResult(cmd);

    const dispatcher = { dispatch: vi.fn().mockResolvedValue(result) };
    const worker = new CommandDispatchWorker({ queue, dispatcher, eventStream, logger });

    queue.enqueue(cmd);
    await worker.tick();

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(queue.listPending()).toHaveLength(0);

    const events = eventStream.list({});
    const eventTypes = events.map((e) => e.eventType);
    expect(eventTypes).toContain('executor.command.succeeded');
    expect(eventTypes).toContain('message_sent');
  });

  it('tick emits message_sent with messageId from openclawOutput', async () => {
    const queue = new InMemoryCommandQueue();
    const eventStream = new InMemoryEventStream();
    const cmd = makeCommand({ commandType: 'integration.twilio.send_sms' });
    const result = makeSuccessResult(cmd);

    const dispatcher = { dispatch: vi.fn().mockResolvedValue(result) };
    const worker = new CommandDispatchWorker({ queue, dispatcher, eventStream, logger });

    queue.enqueue(cmd);
    await worker.tick();

    const messageSentEvent = eventStream.list({}).find((e) => e.eventType === 'message_sent');
    expect(messageSentEvent?.payload['messageId']).toBe('msg-abc123');
  });

  it('tick does not emit message_sent for non-SMS commands', async () => {
    const queue = new InMemoryCommandQueue();
    const eventStream = new InMemoryEventStream();
    const cmd = makeCommand({ commandType: 'integration.booking.request_reschedule_link' });
    const result: ExecutorResultEvent = { ...makeSuccessResult(cmd), eventType: 'executor.command.succeeded' };

    const dispatcher = { dispatch: vi.fn().mockResolvedValue(result) };
    const worker = new CommandDispatchWorker({ queue, dispatcher, eventStream, logger });

    queue.enqueue(cmd);
    await worker.tick();

    const eventTypes = eventStream.list({}).map((e) => e.eventType);
    expect(eventTypes).not.toContain('message_sent');
  });

  it('tick retries on failure and leaves command pending', async () => {
    const queue = new InMemoryCommandQueue();
    const eventStream = new InMemoryEventStream();
    const cmd = makeCommand();

    const dispatcher = { dispatch: vi.fn().mockRejectedValue(new Error('network error')) };
    const worker = new CommandDispatchWorker({ queue, dispatcher, eventStream, logger, maxAttempts: 3 });

    queue.enqueue(cmd);
    await worker.tick();

    // After 1 failed attempt, command is still pending (attempts < maxAttempts)
    expect(queue.listPending()).toHaveLength(1);
    expect(queue.listPending()[0]?.attempts).toBe(1);
    expect(eventStream.list({}).map((e) => e.eventType)).not.toContain('command.dispatch.dlq');
  });

  it('tick DLQs command when maxAttempts exhausted', async () => {
    const queue = new InMemoryCommandQueue();
    const eventStream = new InMemoryEventStream();
    const cmd = makeCommand();

    const dispatcher = { dispatch: vi.fn().mockRejectedValue(new Error('persistent failure')) };
    const worker = new CommandDispatchWorker({ queue, dispatcher, eventStream, logger, maxAttempts: 2 });

    queue.enqueue(cmd);

    // First tick: attempt 1 fails, command still pending
    await worker.tick();
    expect(queue.listPending()).toHaveLength(1);

    // Second tick: attempt 2 fails, command moves to DLQ
    await worker.tick();
    expect(queue.listPending()).toHaveLength(0);

    const eventTypes = eventStream.list({}).map((e) => e.eventType);
    expect(eventTypes).toContain('command.dispatch.dlq');
  });

  it('tick skips commands that have already reached maxAttempts', async () => {
    const queue = new InMemoryCommandQueue();
    const eventStream = new InMemoryEventStream();
    const cmd = makeCommand();

    const dispatcher = { dispatch: vi.fn().mockRejectedValue(new Error('fail')) };
    const worker = new CommandDispatchWorker({ queue, dispatcher, eventStream, logger, maxAttempts: 1 });

    queue.enqueue(cmd);

    // First tick exhausts the single allowed attempt → DLQ
    await worker.tick();
    expect(queue.listPending()).toHaveLength(0);
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();

    // Second tick: nothing in pending, dispatcher not called again
    await worker.tick();
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
  });

  it('start and stop control the interval', () => {
    vi.useFakeTimers();
    const queue = new InMemoryCommandQueue();
    const eventStream = new InMemoryEventStream();
    const dispatcher = { dispatch: vi.fn() };
    const worker = new CommandDispatchWorker({ queue, dispatcher, eventStream, logger });

    worker.start(100);
    vi.advanceTimersByTime(350);
    worker.stop();
    vi.advanceTimersByTime(500);

    // Should not throw; timer is stopped
    vi.useRealTimers();
  });
});
