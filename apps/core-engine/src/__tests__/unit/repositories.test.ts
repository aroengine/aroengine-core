import { describe, expect, it } from 'vitest';

import { FieldEncryption } from '../../data/field-encryption.js';
import {
  AppointmentRepository,
  BusinessConfigRepository,
  CustomerRepository,
  EventStoreRepository,
  ReminderLogRepository,
  WorkflowInstanceRepository,
} from '../../data/repositories.js';

describe('Phase 2 repositories', () => {
  it('supports customer create/find and idempotent upsert by phone', () => {
    const customers = new CustomerRepository();

    const first = customers.upsertByPhone({
      phone: '+15551234567',
      communicationPreference: 'sms',
      riskScore: 20,
      tags: ['vip'],
    });

    const second = customers.upsertByPhone({
      phone: '+15551234567',
      communicationPreference: 'sms',
      riskScore: 45,
      tags: ['vip', 'returning'],
    });

    expect(first.id).toBe(second.id);
    expect(second.riskCategory).toBe('medium');
    expect(customers.findByPhone('+15551234567')?.id).toBe(first.id);
  });

  it('supports appointment creation and transition rules', () => {
    const appointments = new AppointmentRepository();
    const appointment = appointments.create({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      date: new Date(Date.now() + 86_400_000).toISOString(),
      duration: 30,
      serviceType: 'Dental Cleaning',
      serviceCost: 120,
    });

    const confirmed = appointments.updateStatus(appointment.id, 'confirmed');
    expect(confirmed.status).toBe('confirmed');

    expect(() => appointments.updateStatus(appointment.id, 'booked')).toThrowError();
  });

  it('stores and queries reminder logs by appointment', () => {
    const reminders = new ReminderLogRepository();
    const entry = reminders.append({
      appointmentId: '550e8400-e29b-41d4-a716-446655440001',
      sentAt: new Date().toISOString(),
      type: '24h',
      channel: 'sms',
      messageId: 'msg-123',
      delivered: true,
    });

    const logs = reminders.findByAppointment(entry.appointmentId);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.messageId).toBe('msg-123');
  });

  it('appends immutable events and replays from cursor', () => {
    const events = new EventStoreRepository();

    events.append({
      timestamp: new Date().toISOString(),
      type: 'appointment.created',
      entityType: 'appointment',
      entityId: '550e8400-e29b-41d4-a716-446655440002',
      actor: 'webhook',
      data: { source: 'calendly' },
      metadata: { source: 'booking_adapter', version: '1.0.0' },
    });
    events.append({
      timestamp: new Date().toISOString(),
      type: 'reminder.sent',
      entityType: 'appointment',
      entityId: '550e8400-e29b-41d4-a716-446655440002',
      actor: 'system',
      data: { channel: 'sms' },
      metadata: { source: 'workflow_engine', version: '1.0.0' },
    });

    const replay = events.replayFromCursor('2');
    expect(replay).toHaveLength(1);
    expect(replay[0]?.type).toBe('reminder.sent');
  });

  it('persists workflow state updates and active filtering', () => {
    const workflows = new WorkflowInstanceRepository();
    const workflow = workflows.create({
      workflowName: 'reminder-workflow',
      appointmentId: '550e8400-e29b-41d4-a716-446655440003',
      currentState: 'PENDING',
      stateData: {},
      retryCount: 0,
      maxRetries: 3,
    });

    workflows.updateState(workflow.id, {
      currentState: 'RUNNING',
      stateData: { step: 1 },
      retryCount: 0,
    });

    expect(workflows.findActiveByAppointment(workflow.appointmentId)).toHaveLength(1);

    workflows.updateState(workflow.id, {
      currentState: 'COMPLETED',
      stateData: { step: 2 },
      retryCount: 0,
      completedAt: new Date().toISOString(),
    });

    expect(workflows.findActiveByAppointment(workflow.appointmentId)).toHaveLength(0);
  });

  it('stores business config with encrypted API keys at rest', () => {
    const encryption = new FieldEncryption('a'.repeat(64), 'somesecuretestsalt');
    const repository = new BusinessConfigRepository(encryption);

    const saved = repository.upsert({
      businessName: 'Smile Care',
      phone: '+15551234567',
      email: 'hello@smilecare.example',
      timezone: 'America/New_York',
      businessHours: {
        monday: { open: '09:00', close: '17:00', closed: false },
      },
      integrations: {
        booking: {
          provider: 'calendly',
          apiKey: 'booking-secret',
          webhookUrl: 'https://example.com/webhooks/calendly',
        },
      },
      rules: {
        depositThreshold: 60,
        depositAmount: 50,
        reminderTiming: ['48h', '24h'],
        autoRebookingEnabled: false,
        reviewRequestDelay: 6,
      },
    });

    expect(saved.integrations.booking?.apiKey).toBe('booking-secret');
    const encryptedSnapshot = repository.getEncryptedSnapshot();
    expect(encryptedSnapshot?.integrations.booking?.apiKey).not.toBe('booking-secret');
  });
});