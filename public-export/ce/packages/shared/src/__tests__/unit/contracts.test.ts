import { describe, expect, it } from 'vitest';

import {
  commandEnvelopeSchema,
  eventEnvelopeSchema,
  executorCommandSchema,
  executorResultEventSchema,
  permissionManifestSchema,
  profilePackSchema,
} from '../../contracts/index.js';

describe('phase 0 contract schemas', () => {
  it('validates command envelope', () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: '00000000-0000-4000-8000-000000000001',
      commandType: 'reminder.send',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      issuedAt: new Date().toISOString(),
      payload: { foo: 'bar' },
    });

    expect(parsed.commandType).toBe('reminder.send');
  });

  it('validates event envelope', () => {
    const parsed = eventEnvelopeSchema.parse({
      eventId: '00000000-0000-4000-8000-000000000002',
      eventType: 'reminder.sent',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      emittedAt: new Date().toISOString(),
      replayCursor: 'cursor-1',
      payload: { foo: 'bar' },
    });

    expect(parsed.eventType).toBe('reminder.sent');
  });

  it('validates profile pack', () => {
    const parsed = profilePackSchema.parse({
      profileId: 'healthcare',
      profileVersion: '1.0.0',
      policies: ['policy-1'],
      templates: ['template-1'],
      mappings: ['mapping-1'],
    });

    expect(parsed.profileId).toBe('healthcare');
  });

  it('validates executor command and result event', () => {
    const command = executorCommandSchema.parse({
      executionId: '00000000-0000-4000-8000-000000000003',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      commandType: 'integration.twilio.send_sms',
      authorizedByCore: true,
      permissionManifestVersion: '1.0.0',
      payload: { to: '+15551234567' },
    });

    const result = executorResultEventSchema.parse({
      eventId: '00000000-0000-4000-8000-000000000004',
      eventType: 'executor.command.succeeded',
      executionId: command.executionId,
      tenantId: command.tenantId,
      correlationId: command.correlationId,
      emittedAt: new Date().toISOString(),
      status: 'succeeded',
      payload: { providerMessageId: 'msg-1' },
    });

    expect(result.status).toBe('succeeded');
  });

  it('validates permission manifest', () => {
    const parsed = permissionManifestSchema.parse({
      manifestVersion: '1.0.0',
      allowedCommands: ['integration.twilio.send_sms'],
    });

    expect(parsed.allowedCommands).toContain('integration.twilio.send_sms');
  });
});
