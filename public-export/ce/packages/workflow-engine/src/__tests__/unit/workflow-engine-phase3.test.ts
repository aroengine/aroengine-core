import { describe, expect, it } from 'vitest';

import {
  DeadLetterQueue,
  InvalidWorkflowTransitionError,
  RetryExecutor,
  TriggerAction,
  TriggerContext,
  TriggerEngine,
  WorkflowRuntime,
  assertValidAppointmentTransition,
  canTransitionAppointment,
  enforceGuardrails,
  evaluateEscalation,
} from '../../index.js';

describe('WP-0301 appointment state machine', () => {
  it('allows valid transitions and blocks invalid ones', () => {
    expect(canTransitionAppointment('booked', 'confirmed')).toBe(true);
    expect(canTransitionAppointment('completed', 'booked')).toBe(false);
    expect(() => assertValidAppointmentTransition('completed', 'booked')).toThrowError();
  });
});

describe('WP-0302 workflow runtime', () => {
  it('supports lifecycle and retry/fail behavior', () => {
    const runtime = new WorkflowRuntime();
    const instance = runtime.create('reminder-sequence', 'apt-1', 1);

    const running = runtime.transition(instance.id, 'RUNNING');
    expect(running.currentState).toBe('RUNNING');

    const retrying = runtime.failWithRetry(instance.id, { code: 'TIMEOUT', message: 'timeout' });
    expect(retrying.currentState).toBe('RETRYING');

    const failed = runtime.failWithRetry(instance.id, { code: 'TIMEOUT', message: 'timeout again' });
    expect(failed.currentState).toBe('FAILED');

    expect(runtime.getById('missing')).toBeNull();
    expect(() => runtime.transition(instance.id, 'RUNNING')).toThrow(InvalidWorkflowTransitionError);
  });
});

describe('WP-0303 trigger engine', () => {
  it('evaluates conditions and executes immediate and delayed actions deterministically', async () => {
    const scheduled: Array<{ action: TriggerAction; delay: number }> = [];
    const executed: TriggerAction[] = [];

    const engine = new TriggerEngine({
      async execute(action: TriggerAction, context: TriggerContext) {
        executed.push(action);
        void context;
        return { ok: true };
      },
      async schedule(action: TriggerAction, _context: TriggerContext, delayMs: number) {
        scheduled.push({ action, delay: delayMs });
      },
    });

    const result = await engine.executeTrigger(
      {
        id: 't-1',
        name: 'test-trigger',
        type: 'event',
        enabled: true,
        event: 'appointment.created',
        conditions: [
          { field: 'appointment.status', operator: 'IN', value: ['booked', 'confirmed'] },
        ],
        actions: [
          { skill: 'sendReminder' },
          { skill: 'notifyAdmin', delayMs: 2000 },
        ],
        priority: 1,
      },
      {
        appointment: { status: 'booked' },
      },
    );

    expect(result.executed).toBe(true);
    expect(executed).toHaveLength(1);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(2000);
  });

  it('evaluates all supported condition operators and disabled trigger path', () => {
    const engine = new TriggerEngine({
      async execute() {
        return { ok: true };
      },
      async schedule() {
        return;
      },
    });

    const context = { value: 5, status: 'booked' } satisfies TriggerContext;
    expect(engine.evaluateCondition({ field: 'value', operator: '==', value: 5 }, context)).toBe(true);
    expect(engine.evaluateCondition({ field: 'value', operator: '!=', value: 6 }, context)).toBe(true);
    expect(engine.evaluateCondition({ field: 'value', operator: '>', value: 4 }, context)).toBe(true);
    expect(engine.evaluateCondition({ field: 'value', operator: '<', value: 6 }, context)).toBe(true);
    expect(engine.evaluateCondition({ field: 'value', operator: '>=', value: 5 }, context)).toBe(true);
    expect(engine.evaluateCondition({ field: 'value', operator: '<=', value: 5 }, context)).toBe(true);
    expect(engine.evaluateCondition({ field: 'status', operator: 'IN', value: ['booked'] }, context)).toBe(true);
    expect(engine.evaluateCondition({ field: 'status', operator: 'NOT IN', value: ['cancelled'] }, context)).toBe(
      true,
    );

    expect(
      engine.evaluateTrigger(
        {
          id: 'disabled',
          name: 'disabled',
          type: 'event',
          enabled: false,
          conditions: [],
          actions: [],
          priority: 1,
        },
        context,
      ),
    ).toBe(false);
  });

  it('stops execution on failure when retryOnFailure is false', async () => {
    const results: string[] = [];
    const engine = new TriggerEngine({
      async execute(action: TriggerAction) {
        if (action.skill === 'first') {
          throw new Error('failed');
        }
        results.push(action.skill);
        return true;
      },
      async schedule() {
        return;
      },
    });

    const outcome = await engine.executeTrigger(
      {
        id: 't',
        name: 't',
        type: 'event',
        enabled: true,
        conditions: [],
        actions: [{ skill: 'first', retryOnFailure: false }, { skill: 'second' }],
        priority: 1,
      },
      {},
    );

    expect(outcome.results[0]?.status).toBe('failed');
    expect(results).toHaveLength(0);
  });
});

describe('WP-0304 retry executor', () => {
  it('retries retryable errors with bounded backoff and succeeds', async () => {
    const slept: number[] = [];
    let attempts = 0;
    const retryExecutor = new RetryExecutor({
      async sleep(ms) {
        slept.push(ms);
      },
      random() {
        return 0;
      },
    });

    const result = await retryExecutor.execute(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('timeout') as Error & { code: string };
          error.code = 'TIMEOUT';
          throw error;
        }
        return 'ok';
      },
      {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        retryableErrorCodes: ['TIMEOUT'],
      },
    );

    expect(result).toBe('ok');
    expect(slept).toEqual([10, 20]);
  });

  it('fails fast on non-retryable error code', async () => {
    const retryExecutor = new RetryExecutor({
      async sleep() {
        return;
      },
      random() {
        return 0;
      },
    });

    await expect(
      retryExecutor.execute(
        async () => {
          const error = new Error('bad request') as Error & { code: string };
          error.code = '400';
          throw error;
        },
        {
          maxAttempts: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          retryableErrorCodes: ['TIMEOUT'],
        },
      ),
    ).rejects.toThrowError('bad request');
  });
});

describe('WP-0305 dead letter queue', () => {
  it('supports add, retry, archive and retention purge', () => {
    const dlq = new DeadLetterQueue();
    const entry = dlq.add({
      workflowId: 'wf-1',
      skillName: 'sendReminder',
      context: { appointmentId: 'apt-1' },
      error: { code: 'SEND_FAILED', message: 'provider unavailable' },
      attempts: 1,
    });

    expect(dlq.listActive()).toHaveLength(1);

    const retried = dlq.retry(entry.id);
    expect(retried.attempts).toBe(2);

    const archived = dlq.archive(entry.id);
    expect(archived.archived).toBe(true);
    expect(dlq.listActive()).toHaveLength(0);

    const purged = dlq.purgeOlderThan(0);
    expect(purged).toBe(1);
  });
});

describe('WP-0306 guardrails and escalation', () => {
  it('blocks unsafe autonomous actions and evaluates escalation rules', () => {
    expect(() =>
      enforceGuardrails({
        action: 'cancel_appointment',
        actor: 'system',
      }),
    ).toThrowError();

    expect(() =>
      enforceGuardrails({
        action: 'charge_payment',
        actor: 'system',
        userConfirmed: false,
      }),
    ).toThrowError();

    expect(() =>
      enforceGuardrails({
        action: 'send_message',
        actor: 'system',
        messageType: 'llm_generated',
        message: 'I can diagnose and prescribe treatment',
      }),
    ).toThrowError();

    const escalation = evaluateEscalation({
      customerRiskScore: 81,
      workflowRetryCount: 0,
      hoursUntilAppointment: 24,
      customerResponded: true,
    });
    expect(escalation.shouldEscalate).toBe(true);
    expect(escalation.priority).toBe('high');

    expect(
      evaluateEscalation({
        customerRiskScore: 30,
        workflowRetryCount: 0,
        hoursUntilAppointment: 24,
        customerResponded: true,
      }).shouldEscalate,
    ).toBe(false);

    expect(() =>
      enforceGuardrails({
        action: 'send_message',
        actor: 'system',
        messageType: 'llm_generated',
        message: 'Your reminder is confirmed',
      }),
    ).not.toThrowError();
  });
});