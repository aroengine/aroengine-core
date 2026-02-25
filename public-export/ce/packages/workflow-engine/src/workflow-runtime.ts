import { randomUUID } from 'node:crypto';

import { WorkflowRuntimeInstance, WorkflowState } from './types.js';

const allowedWorkflowTransitions: Record<WorkflowState, WorkflowState[]> = {
  PENDING: ['RUNNING', 'CANCELLED'],
  RUNNING: ['WAITING', 'RETRYING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  WAITING: ['RUNNING', 'RETRYING', 'FAILED', 'CANCELLED'],
  RETRYING: ['RUNNING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export class InvalidWorkflowTransitionError extends Error {
  constructor(from: WorkflowState, to: WorkflowState) {
    super(`Invalid workflow transition: ${from} -> ${to}`);
    this.name = 'InvalidWorkflowTransitionError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export class WorkflowRuntime {
  private readonly byId = new Map<string, WorkflowRuntimeInstance>();

  create(workflowName: string, appointmentId: string, maxRetries = 3): WorkflowRuntimeInstance {
    const timestamp = nowIso();
    const instance: WorkflowRuntimeInstance = {
      id: randomUUID(),
      workflowName,
      appointmentId,
      currentState: 'PENDING',
      stateData: {},
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
      retryCount: 0,
      maxRetries,
    };
    this.byId.set(instance.id, instance);
    return instance;
  }

  getById(id: string): WorkflowRuntimeInstance | null {
    return this.byId.get(id) ?? null;
  }

  transition(
    id: string,
    toState: WorkflowState,
    stateData: Record<string, unknown> = {},
  ): WorkflowRuntimeInstance {
    const current = this.byId.get(id);
    if (current === undefined) {
      throw new Error(`Workflow instance not found: ${id}`);
    }

    if (!allowedWorkflowTransitions[current.currentState].includes(toState)) {
      throw new InvalidWorkflowTransitionError(current.currentState, toState);
    }

    const timestamp = nowIso();
    const next: WorkflowRuntimeInstance = {
      ...current,
      currentState: toState,
      stateData: {
        ...current.stateData,
        ...stateData,
      },
      lastUpdatedAt: timestamp,
      ...(toState === 'COMPLETED' ? { completedAt: timestamp } : {}),
      ...(toState === 'FAILED' ? { failedAt: timestamp } : {}),
    };

    this.byId.set(id, next);
    return next;
  }

  failWithRetry(
    id: string,
    error: { message: string; code?: string },
  ): WorkflowRuntimeInstance {
    const current = this.byId.get(id);
    if (current === undefined) {
      throw new Error(`Workflow instance not found: ${id}`);
    }

    const nextRetryCount = current.retryCount + 1;
    if (nextRetryCount > current.maxRetries) {
      const failed = this.transition(id, 'FAILED');
      const withError: WorkflowRuntimeInstance = {
        ...failed,
        retryCount: nextRetryCount,
        error: {
          message: error.message,
          ...(error.code === undefined ? {} : { code: error.code }),
          timestamp: nowIso(),
        },
      };
      this.byId.set(id, withError);
      return withError;
    }

    const retrying = this.transition(id, 'RETRYING');
    const withError: WorkflowRuntimeInstance = {
      ...retrying,
      retryCount: nextRetryCount,
      error: {
        message: error.message,
        ...(error.code === undefined ? {} : { code: error.code }),
        timestamp: nowIso(),
      },
    };
    this.byId.set(id, withError);
    return withError;
  }
}