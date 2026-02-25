import { z } from 'zod';

export const commandEnvelopeSchema = z.object({
  commandId: z.string().uuid(),
  commandType: z.string().min(1),
  tenantId: z.string().min(1),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  issuedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export const eventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  tenantId: z.string().min(1),
  correlationId: z.string().min(1),
  emittedAt: z.string().datetime(),
  replayCursor: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const profilePackSchema = z.object({
  profileId: z.string().min(1),
  profileVersion: z.string().min(1),
  policies: z.array(z.string()),
  templates: z.array(z.string()),
  mappings: z.array(z.string()),
});

export const executorCommandSchema = z.object({
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

export const permissionManifestSchema = z.object({
  manifestVersion: z.string().min(1),
  allowedCommands: z.array(z.string().min(1)).min(1),
});

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type ProfilePack = z.infer<typeof profilePackSchema>;
export type ExecutorCommand = z.infer<typeof executorCommandSchema>;
export type ExecutorResultEvent = z.infer<typeof executorResultEventSchema>;
export type PermissionManifest = z.infer<typeof permissionManifestSchema>;
