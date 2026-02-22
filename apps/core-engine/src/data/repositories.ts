import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { FieldEncryption } from './field-encryption.js';
import {
  AppointmentRecord,
  AppointmentStatus,
  BusinessConfigRecord,
  CustomerRecord,
  EventRecord,
  ReminderLogRecord,
  WorkflowInstanceRecord,
} from './types.js';
import {
  appointmentInputSchema,
  assertValidAppointmentTransition,
  customerInputSchema,
} from './validation.js';

function nowIso(): string {
  return new Date().toISOString();
}

export class CustomerRepository {
  private readonly byId = new Map<string, CustomerRecord>();
  private readonly idByPhone = new Map<string, string>();

  create(input: z.infer<typeof customerInputSchema>): CustomerRecord {
    const parsed = customerInputSchema.parse(input);
    const existingId = this.idByPhone.get(parsed.phone);
    if (existingId !== undefined) {
      throw new Error(`Customer already exists for phone ${parsed.phone}`);
    }

    const createdAt = nowIso();
    const customer: CustomerRecord = {
      id: randomUUID(),
      phone: parsed.phone,
      ...(parsed.email === undefined ? {} : { email: parsed.email }),
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      noShowCount: 0,
      rescheduleCount: 0,
      cancelCount: 0,
      confirmationRate: 0,
      lifetimeValue: 0,
      paymentStatus: 'no_history',
      depositsPaid: 0,
      reviewStatus: 'none',
      communicationPreference: parsed.communicationPreference,
      riskScore: parsed.riskScore,
      riskCategory: parsed.riskScore >= 70 ? 'high' : parsed.riskScore >= 40 ? 'medium' : 'low',
      requiresDeposit: false,
      tags: parsed.tags,
      createdAt,
      updatedAt: createdAt,
    };

    this.byId.set(customer.id, customer);
    this.idByPhone.set(customer.phone, customer.id);
    return customer;
  }

  upsertByPhone(input: z.infer<typeof customerInputSchema>): CustomerRecord {
    const parsed = customerInputSchema.parse(input);
    const existingId = this.idByPhone.get(parsed.phone);
    if (existingId === undefined) {
      return this.create(parsed);
    }

    const current = this.byId.get(existingId);
    if (current === undefined) {
      throw new Error(`Customer index corruption detected for phone ${parsed.phone}`);
    }

    const updated: CustomerRecord = {
      ...current,
      ...(parsed.email !== undefined ? { email: parsed.email } : {}),
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      communicationPreference: parsed.communicationPreference,
      riskScore: parsed.riskScore,
      riskCategory: parsed.riskScore >= 70 ? 'high' : parsed.riskScore >= 40 ? 'medium' : 'low',
      tags: parsed.tags,
      updatedAt: nowIso(),
    };

    this.byId.set(updated.id, updated);
    return updated;
  }

  findById(id: string): CustomerRecord | null {
    return this.byId.get(id) ?? null;
  }

  findByPhone(phone: string): CustomerRecord | null {
    const id = this.idByPhone.get(phone);
    if (id === undefined) {
      return null;
    }

    return this.byId.get(id) ?? null;
  }
}

export class AppointmentRepository {
  private readonly byId = new Map<string, AppointmentRecord>();

  create(input: z.infer<typeof appointmentInputSchema>): AppointmentRecord {
    const parsed = appointmentInputSchema.parse(input);
    const createdAt = nowIso();

    const appointment: AppointmentRecord = {
      id: randomUUID(),
      customerId: parsed.customerId,
      date: parsed.date,
      duration: parsed.duration,
      serviceType: parsed.serviceType,
      serviceCost: parsed.serviceCost,
      ...(parsed.provider === undefined ? {} : { provider: parsed.provider }),
      ...(parsed.location === undefined ? {} : { location: parsed.location }),
      status: 'booked',
      previousStatus: [],
      confirmationReceived: false,
      depositRequired: false,
      depositPaid: false,
      createdAt,
      updatedAt: createdAt,
      ...(parsed.notes === undefined ? {} : { notes: parsed.notes }),
    };

    this.byId.set(appointment.id, appointment);
    return appointment;
  }

  findById(id: string): AppointmentRecord | null {
    return this.byId.get(id) ?? null;
  }

  updateStatus(id: string, nextStatus: AppointmentStatus): AppointmentRecord {
    const current = this.byId.get(id);
    if (current === undefined) {
      throw new Error(`Appointment not found: ${id}`);
    }

    assertValidAppointmentTransition(current.status, nextStatus);
    const updatedAt = nowIso();

    const updated: AppointmentRecord = {
      ...current,
      previousStatus:
        current.status === nextStatus ? current.previousStatus : [...current.previousStatus, current.status],
      status: nextStatus,
      updatedAt,
      ...(nextStatus === 'completed'
        ? { completedAt: updatedAt }
        : current.completedAt === undefined
          ? {}
          : { completedAt: current.completedAt }),
      ...(nextStatus === 'cancelled'
        ? { cancelledAt: updatedAt }
        : current.cancelledAt === undefined
          ? {}
          : { cancelledAt: current.cancelledAt }),
    };

    this.byId.set(id, updated);
    return updated;
  }
}

export class ReminderLogRepository {
  private readonly byAppointmentId = new Map<string, ReminderLogRecord[]>();

  append(record: Omit<ReminderLogRecord, 'id' | 'createdAt'>): ReminderLogRecord {
    const reminder: ReminderLogRecord = {
      ...record,
      id: randomUUID(),
      createdAt: nowIso(),
    };

    const existing = this.byAppointmentId.get(record.appointmentId) ?? [];
    this.byAppointmentId.set(record.appointmentId, [...existing, reminder]);
    return reminder;
  }

  findByAppointment(appointmentId: string): ReminderLogRecord[] {
    return this.byAppointmentId.get(appointmentId) ?? [];
  }
}

export class EventStoreRepository {
  private readonly records: EventRecord[] = [];

  append(event: Omit<EventRecord, 'id' | 'replayCursor' | 'createdAt'>): EventRecord {
    const record: EventRecord = {
      ...event,
      id: randomUUID(),
      replayCursor: String(this.records.length + 1),
      createdAt: nowIso(),
    };

    this.records.push(record);
    return record;
  }

  queryByEntity(entityType: EventRecord['entityType'], entityId: string): EventRecord[] {
    return this.records.filter((record) => record.entityType === entityType && record.entityId === entityId);
  }

  queryByType(type: string): EventRecord[] {
    return this.records.filter((record) => record.type === type);
  }

  replayFromCursor(cursor: string): EventRecord[] {
    const cursorValue = Number(cursor);
    if (Number.isNaN(cursorValue) || cursorValue < 1) {
      throw new Error(`Invalid replay cursor: ${cursor}`);
    }

    return this.records.filter((record) => Number(record.replayCursor) >= cursorValue);
  }
}

export class WorkflowInstanceRepository {
  private readonly byId = new Map<string, WorkflowInstanceRecord>();

  create(input: Omit<WorkflowInstanceRecord, 'id' | 'startedAt' | 'lastUpdatedAt' | 'createdAt'>) {
    const startedAt = nowIso();
    const workflow: WorkflowInstanceRecord = {
      ...input,
      id: randomUUID(),
      startedAt,
      lastUpdatedAt: startedAt,
      createdAt: startedAt,
    };

    this.byId.set(workflow.id, workflow);
    return workflow;
  }

  findById(id: string): WorkflowInstanceRecord | null {
    return this.byId.get(id) ?? null;
  }

  updateState(
    id: string,
    updates: Pick<WorkflowInstanceRecord, 'currentState' | 'stateData' | 'retryCount'> &
      Partial<Pick<WorkflowInstanceRecord, 'completedAt' | 'failedAt' | 'error'>>,
  ): WorkflowInstanceRecord {
    const current = this.byId.get(id);
    if (current === undefined) {
      throw new Error(`Workflow instance not found: ${id}`);
    }

    const updated: WorkflowInstanceRecord = {
      ...current,
      ...updates,
      lastUpdatedAt: nowIso(),
    };

    this.byId.set(id, updated);
    return updated;
  }

  findActiveByAppointment(appointmentId: string): WorkflowInstanceRecord[] {
    return Array.from(this.byId.values()).filter(
      (workflow) =>
        workflow.appointmentId === appointmentId &&
        workflow.completedAt === undefined &&
        workflow.failedAt === undefined,
    );
  }
}

type EncryptedIntegrations = BusinessConfigRecord['integrations'];

function encryptIntegrations(
  integrations: BusinessConfigRecord['integrations'],
  encryption: FieldEncryption,
): EncryptedIntegrations {
  const encrypted: EncryptedIntegrations = {};

  if (integrations.booking !== undefined) {
    encrypted.booking = {
      ...integrations.booking,
      apiKey: encryption.encrypt(integrations.booking.apiKey),
    };
  }

  if (integrations.messaging !== undefined) {
    encrypted.messaging = {
      ...integrations.messaging,
      apiKey: encryption.encrypt(integrations.messaging.apiKey),
    };
  }

  if (integrations.payment !== undefined) {
    encrypted.payment = {
      ...integrations.payment,
      apiKey: encryption.encrypt(integrations.payment.apiKey),
    };
  }

  return encrypted;
}

function decryptIntegrations(
  integrations: EncryptedIntegrations,
  encryption: FieldEncryption,
): BusinessConfigRecord['integrations'] {
  const decrypted: BusinessConfigRecord['integrations'] = {};

  if (integrations.booking !== undefined) {
    decrypted.booking = {
      ...integrations.booking,
      apiKey: encryption.decrypt(integrations.booking.apiKey),
    };
  }

  if (integrations.messaging !== undefined) {
    decrypted.messaging = {
      ...integrations.messaging,
      apiKey: encryption.decrypt(integrations.messaging.apiKey),
    };
  }

  if (integrations.payment !== undefined) {
    decrypted.payment = {
      ...integrations.payment,
      apiKey: encryption.decrypt(integrations.payment.apiKey),
    };
  }

  return decrypted;
}

export class BusinessConfigRepository {
  private encryptedRecord: BusinessConfigRecord | null = null;

  constructor(private readonly encryption: FieldEncryption) {}

  upsert(input: Omit<BusinessConfigRecord, 'id' | 'createdAt' | 'updatedAt'>): BusinessConfigRecord {
    const timestamp = nowIso();
    const current = this.encryptedRecord;

    const record: BusinessConfigRecord = {
      id: current?.id ?? randomUUID(),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...input,
      integrations: encryptIntegrations(input.integrations, this.encryption),
    };

    this.encryptedRecord = record;
    return this.get();
  }

  get(): BusinessConfigRecord {
    if (this.encryptedRecord === null) {
      throw new Error('Business config not initialized');
    }

    return {
      ...this.encryptedRecord,
      integrations: decryptIntegrations(this.encryptedRecord.integrations, this.encryption),
    };
  }

  getEncryptedSnapshot(): BusinessConfigRecord | null {
    return this.encryptedRecord;
  }
}