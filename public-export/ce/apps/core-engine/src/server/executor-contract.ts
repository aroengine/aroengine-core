import { z } from 'zod';

export const coreToExecutorCommandSchema = z.object({
  executionId: z.string().uuid(),
  tenantId: z.string().min(1),
  correlationId: z.string().min(1),
  commandType: z.string().min(1),
  authorizedByCore: z.literal(true),
  permissionManifestVersion: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const executorResultEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  executionId: z.string().uuid(),
  tenantId: z.string().min(1),
  correlationId: z.string().min(1),
  emittedAt: z.string().datetime(),
  status: z.enum(['succeeded', 'failed']),
  payload: z.record(z.string(), z.unknown()),
});

export type CoreToExecutorCommand = z.infer<typeof coreToExecutorCommandSchema>;
export type ExecutorResultEvent = z.infer<typeof executorResultEventSchema>;

export interface ExecutorDispatcher {
  dispatch(command: CoreToExecutorCommand): Promise<ExecutorResultEvent>;
}
