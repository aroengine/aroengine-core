import {
  CoreToExecutorCommand,
  ExecutorDispatcher,
  ExecutorResultEvent,
  executorResultEventSchema,
} from './executor-contract.js';

export interface OpenclawDispatcherOptions {
  baseUrl: string;
  sharedToken: string;
}

export class HttpOpenclawDispatcher implements ExecutorDispatcher {
  constructor(private readonly options: OpenclawDispatcherOptions) {}

  async dispatch(command: CoreToExecutorCommand): Promise<ExecutorResultEvent> {
    const response = await fetch(`${this.options.baseUrl}/v1/executions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.sharedToken}`,
        'x-tenant-id': command.tenantId,
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Executor dispatch failed (${response.status}): ${text}`);
    }

    const parsed = executorResultEventSchema.parse(await response.json());
    return parsed;
  }
}
