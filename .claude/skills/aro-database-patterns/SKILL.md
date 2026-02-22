---
name: aro-database-patterns
description: Implement database patterns for ARO including migrations, repositories,
  idempotency, and data models. Based on docs/specs/02_data_models.md. Use when working
  with database schema, migrations, or data access patterns.
---

# ARO Database Patterns

Production-grade database implementation for the Appointment Revenue Optimizer.

## Technology Choices

- **SQLite** (self-hosted/MVP): Default, file-based, no setup required
- **PostgreSQL** (cloud/production): For scaling, partitioning, advanced features
- **ORM/Query Builder**: Kysely (recommended), Knex, or Prisma

## Schema Overview

### Core Tables

```sql
-- Customers
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(255),
  name VARCHAR(255),

  no_show_count INTEGER DEFAULT 0,
  reschedule_count INTEGER DEFAULT 0,
  cancel_count INTEGER DEFAULT 0,
  confirmation_rate DECIMAL(5,2) DEFAULT 0.00,

  lifetime_value DECIMAL(10,2) DEFAULT 0.00,
  payment_status VARCHAR(20) DEFAULT 'no_history',
  deposits_paid INTEGER DEFAULT 0,

  review_status VARCHAR(20) DEFAULT 'none',
  last_review_request_date TIMESTAMP,
  communication_preference VARCHAR(20) DEFAULT 'sms',

  risk_score INTEGER DEFAULT 0,
  risk_category VARCHAR(20) DEFAULT 'low',
  requires_deposit BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  tags TEXT[]
);

CREATE INDEX idx_customer_phone ON customers(phone);
CREATE INDEX idx_customer_risk ON customers(risk_category, risk_score);
CREATE INDEX idx_customer_updated ON customers(updated_at DESC);

-- Appointments
CREATE TYPE appointment_status AS ENUM (
  'booked', 'confirmed', 'rescheduled', 'cancelled', 'no_show', 'completed', 'in_progress'
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(255),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  date TIMESTAMP NOT NULL,
  duration INTEGER NOT NULL,
  service_type VARCHAR(255) NOT NULL,
  service_cost DECIMAL(10,2) NOT NULL,
  provider VARCHAR(255),
  location VARCHAR(255),

  status appointment_status NOT NULL DEFAULT 'booked',
  previous_status appointment_status[],

  confirmation_received BOOLEAN DEFAULT FALSE,
  confirmation_date TIMESTAMP,
  response_classification VARCHAR(20),

  deposit_required BOOLEAN DEFAULT FALSE,
  deposit_amount DECIMAL(10,2),
  deposit_paid BOOLEAN DEFAULT FALSE,
  deposit_payment_id VARCHAR(255),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  notes TEXT
);

CREATE INDEX idx_appointment_customer ON appointments(customer_id);
CREATE INDEX idx_appointment_date ON appointments(date);
CREATE INDEX idx_appointment_status ON appointments(status);
CREATE INDEX idx_appointment_upcoming ON appointments(date) WHERE status IN ('booked', 'confirmed');

-- Reminder Logs
CREATE TABLE reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  sent_at TIMESTAMP NOT NULL,
  type VARCHAR(10) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  message_id VARCHAR(255),
  delivered BOOLEAN DEFAULT FALSE,
  read BOOLEAN,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reminder_appointment ON reminder_logs(appointment_id);
CREATE INDEX idx_reminder_sent ON reminder_logs(sent_at DESC);

-- Events (Audit Log)
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,

  actor VARCHAR(50) NOT NULL,
  actor_id VARCHAR(255),

  data JSONB NOT NULL,
  metadata JSONB NOT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_event_timestamp ON events(timestamp DESC);
CREATE INDEX idx_event_type ON events(type);
CREATE INDEX idx_event_entity ON events(entity_type, entity_id);
CREATE INDEX idx_event_actor ON events(actor, actor_id);

-- Workflow Instances
CREATE TABLE workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name VARCHAR(255) NOT NULL,
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,

  current_state VARCHAR(100) NOT NULL,
  state_data JSONB,

  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  failed_at TIMESTAMP,

  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,

  error JSONB,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workflow_appointment ON workflow_instances(appointment_id);
CREATE INDEX idx_workflow_state ON workflow_instances(current_state);
CREATE INDEX idx_workflow_active ON workflow_instances(completed_at, failed_at)
  WHERE completed_at IS NULL AND failed_at IS NULL;

-- Business Config (Single Row)
CREATE TABLE business_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name VARCHAR(255) NOT NULL,

  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255) NOT NULL,
  address TEXT,
  timezone VARCHAR(50) NOT NULL DEFAULT 'America/New_York',

  business_hours JSONB NOT NULL,
  integrations JSONB NOT NULL,  -- Encrypted fields
  rules JSONB NOT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Only one config per installation
CREATE UNIQUE INDEX idx_single_config ON business_config ((1));

-- Consents (TCPA Compliance)
CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL,
  consent_given BOOLEAN DEFAULT FALSE,
  consent_date TIMESTAMP,
  consent_method VARCHAR(50),
  opt_out_date TIMESTAMP,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consent_customer ON consents(customer_id);
CREATE INDEX idx_consent_phone ON consents(phone);

-- Idempotency Keys (Webhook Deduplication)
CREATE TABLE idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  response JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at)
  WHERE expires_at IS NOT NULL;

-- Dead Letters (Failed Workflows)
CREATE TABLE dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID,
  skill_name VARCHAR(255),
  context JSONB,
  error JSONB,
  attempts INTEGER DEFAULT 1,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dead_letters_created ON dead_letters(created_at DESC);
CREATE INDEX idx_dead_letters_archived ON dead_letters(archived)
  WHERE archived = FALSE;
```

## Migration Strategy

### Directory Structure

```
migrations/
├── 001_initial_schema.sql
├── 002_add_reminder_logs.sql
├── 003_add_workflow_instances.sql
├── 004_add_consents_table.sql
├── 005_add_idempotency_keys.sql
└── 006_add_dead_letters.sql
```

### Migration Files

```sql
-- migrations/001_initial_schema.sql

-- +migrate Up
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(255),
  name VARCHAR(255),
  no_show_count INTEGER DEFAULT 0,
  reschedule_count INTEGER DEFAULT 0,
  cancel_count INTEGER DEFAULT 0,
  confirmation_rate DECIMAL(5,2) DEFAULT 0.00,
  lifetime_value DECIMAL(10,2) DEFAULT 0.00,
  payment_status VARCHAR(20) DEFAULT 'no_history',
  deposits_paid INTEGER DEFAULT 0,
  review_status VARCHAR(20) DEFAULT 'none',
  last_review_request_date TIMESTAMP,
  communication_preference VARCHAR(20) DEFAULT 'sms',
  risk_score INTEGER DEFAULT 0,
  risk_category VARCHAR(20) DEFAULT 'low',
  requires_deposit BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  tags TEXT[]
);

CREATE INDEX idx_customer_phone ON customers(phone);

-- +migrate Down
DROP INDEX idx_customer_phone;
DROP TABLE customers;
```

### Migration Runner

```typescript
// scripts/migrate.ts
import fs from 'fs';
import path from 'path';
import { db } from '../src/db';

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const migrationName = file.replace('.sql', '');

    // Check if already applied
    const applied = await db.raw(`
      SELECT 1 FROM schema_migrations WHERE name = ?
    `, [migrationName]);

    if (applied.rows.length > 0) {
      console.log(`Skipping ${migrationName} (already applied)`);
      continue;
    }

    console.log(`Running migration: ${migrationName}`);

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const [upSql] = sql.split('-- +migrate Down');

    await db.raw(upSql.replace('-- +migrate Up', '').trim());
    await db.raw(`INSERT INTO schema_migrations (name) VALUES (?)`, [migrationName]);

    console.log(`✓ ${migrationName} complete`);
  }
}

runMigrations().then(() => process.exit(0)).catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

## Repository Pattern

### Base Repository

```typescript
// packages/database/src/repository.ts
import { Kysely } from 'kysely';

interface BaseEntity {
  id: string;
  created_at: Date;
  updated_at: Date;
}

export abstract class Repository<T extends BaseEntity> {
  constructor(
    protected readonly db: Kysely<Database>,
    protected readonly tableName: string
  ) {}

  async findById(id: string): Promise<T | null> {
    const row = await this.db
      .selectFrom(this.tableName as any)
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirst();

    return row as T | null;
  }

  async findAll(filter?: Partial<T>): Promise<T[]> {
    let query = this.db
      .selectFrom(this.tableName as any)
      .selectAll();

    if (filter) {
      Object.entries(filter).forEach(([key, value]) => {
        if (value !== undefined) {
          query = query.where(key as any, '=', value);
        }
      });
    }

    return query.execute() as Promise<T[]>;
  }

  async create(entity: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T> {
    const now = new Date();
    const row = await this.db
      .insertInto(this.tableName as any)
      .values({
        ...entity,
        id: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    return row as T;
  }

  async update(id: string, updates: Partial<T>): Promise<T> {
    const row = await this.db
      .updateTable(this.tableName as any)
      .set({
        ...updates,
        updated_at: new Date(),
      } as any)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return row as T;
  }

  async delete(id: string): Promise<void> {
    await this.db
      .deleteFrom(this.tableName as any)
      .where('id', '=', id)
      .execute();
  }
}
```

### Customer Repository

```typescript
// packages/database/src/repositories/customer-repository.ts
import { Repository } from '../repository';
import { Kysely } from 'kysely';

export interface Customer {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  no_show_count: number;
  reschedule_count: number;
  cancel_count: number;
  confirmation_rate: number;
  lifetime_value: number;
  payment_status: 'current' | 'past_due' | 'no_history';
  deposits_paid: number;
  review_status: 'pending' | 'requested' | 'submitted' | 'none';
  last_review_request_date: Date | null;
  communication_preference: 'sms' | 'whatsapp' | 'email';
  risk_score: number;
  risk_category: 'low' | 'medium' | 'high' | 'blocked';
  requires_deposit: boolean;
  created_at: Date;
  updated_at: Date;
  tags: string[];
}

export class CustomerRepository extends Repository<Customer> {
  constructor(db: Kysely<Database>) {
    super(db, 'customers');
  }

  async findByPhone(phone: string): Promise<Customer | null> {
    const row = await this.db
      .selectFrom('customers')
      .where('phone', '=', phone)
      .selectAll()
      .executeTakeFirst();

    return row ?? null;
  }

  async findHighRisk(): Promise<Customer[]> {
    return this.db
      .selectFrom('customers')
      .where('risk_category', 'in', ['high', 'blocked'])
      .selectAll()
      .execute();
  }

  async updateRiskScore(id: string, score: number, category: string): Promise<void> {
    await this.db
      .updateTable('customers')
      .set({
        risk_score: score,
        risk_category: category,
        requires_deposit: score >= 70,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async incrementNoShowCount(id: string): Promise<void> {
    await this.db
      .updateTable('customers')
      .set({
        no_show_count: db.raw('no_show_count + 1'),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  // Idempotent upsert for webhook deduplication
  async upsertByPhone(
    customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>
  ): Promise<Customer> {
    const existing = await this.findByPhone(customer.phone);
    if (existing) {
      return existing;
    }
    return this.create(customer);
  }
}
```

### Appointment Repository

```typescript
// packages/database/src/repositories/appointment-repository.ts
import { Repository } from '../repository';
import { Kysely } from 'kysely';

export type AppointmentStatus =
  | 'booked'
  | 'confirmed'
  | 'rescheduled'
  | 'cancelled'
  | 'no_show'
  | 'completed'
  | 'in_progress';

export interface Appointment {
  id: string;
  external_id: string | null;
  customer_id: string;
  date: Date;
  duration: number;
  service_type: string;
  service_cost: number;
  provider: string | null;
  location: string | null;
  status: AppointmentStatus;
  previous_status: AppointmentStatus[] | null;
  confirmation_received: boolean;
  confirmation_date: Date | null;
  response_classification: string | null;
  deposit_required: boolean;
  deposit_amount: number | null;
  deposit_paid: boolean;
  deposit_payment_id: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
  notes: string | null;
}

// State transition rules
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ['confirmed', 'rescheduled', 'cancelled', 'no_show', 'in_progress'],
  confirmed: ['rescheduled', 'cancelled', 'in_progress', 'no_show'],
  rescheduled: ['booked'],
  in_progress: ['completed', 'no_show'],
  completed: [],     // Terminal state
  no_show: [],       // Terminal state
  cancelled: [],     // Terminal state
};

export class AppointmentRepository extends Repository<Appointment> {
  constructor(db: Kysely<Database>) {
    super(db, 'appointments');
  }

  canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  async updateStatus(
    id: string,
    newStatus: AppointmentStatus
  ): Promise<Appointment> {
    const current = await this.findById(id);
    if (!current) {
      throw new Error(`Appointment not found: ${id}`);
    }

    if (!this.canTransition(current.status, newStatus)) {
      throw new Error(
        `Invalid transition from ${current.status} to ${newStatus}`
      );
    }

    return this.db.transaction().execute(async (trx) => {
      // Update appointment
      const updated = await trx
        .updateTable('appointments')
        .set({
          status: newStatus,
          previous_status: [
            ...(current.previous_status ?? []),
            current.status,
          ],
          updated_at: new Date(),
          ...(newStatus === 'completed' && { completed_at: new Date() }),
          ...(newStatus === 'cancelled' && { cancelled_at: new Date() }),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return updated as Appointment;
    });
  }

  async findUpcoming(): Promise<Appointment[]> {
    return this.db
      .selectFrom('appointments')
      .where('status', 'in', ['booked', 'confirmed'])
      .where('date', '>=', new Date())
      .orderBy('date', 'asc')
      .selectAll()
      .execute();
  }

  async findByCustomerId(customerId: string): Promise<Appointment[]> {
    return this.db
      .selectFrom('appointments')
      .where('customer_id', '=', customerId)
      .orderBy('date', 'desc')
      .selectAll()
      .execute();
  }

  async findByExternalId(externalId: string): Promise<Appointment | null> {
    const row = await this.db
      .selectFrom('appointments')
      .where('external_id', '=', externalId)
      .selectAll()
      .executeTakeFirst();

    return row ?? null;
  }

  // Idempotent create for webhook deduplication
  async upsertByExternalId(
    appointment: Omit<Appointment, 'id' | 'created_at' | 'updated_at'>
  ): Promise<Appointment> {
    if (appointment.external_id) {
      const existing = await this.findByExternalId(appointment.external_id);
      if (existing) {
        return existing;
      }
    }
    return this.create(appointment);
  }
}
```

## Idempotency Pattern

### Webhook Idempotency

```typescript
// Idempotency key handling for webhooks
export class IdempotencyService {
  constructor(private readonly db: Kysely<Database>) {}

  async checkAndLock(key: string, ttlMs: number = 86400000): Promise<boolean> {
    const now = new Date();
    const expires = new Date(now.getTime() + ttlMs);

    try {
      await this.db
        .insertInto('idempotency_keys')
        .values({
          key,
          response: null,
          expires_at: expires,
        })
        .execute();

      return true; // Key was acquired
    } catch (error: unknown) {
      // Unique constraint violation - key already exists
      const err = error as { code?: string };
      if (err.code === '23505') {
        return false; // Key already processed
      }
      throw error;
    }
  }

  async storeResponse(key: string, response: unknown): Promise<void> {
    await this.db
      .updateTable('idempotency_keys')
      .set({ response: JSON.parse(JSON.stringify(response)) })
      .where('key', '=', key)
      .execute();
  }

  async getResponse(key: string): Promise<unknown | null> {
    const row = await this.db
      .selectFrom('idempotency_keys')
      .where('key', '=', key)
      .select('response')
      .executeTakeFirst();

    return row?.response ?? null;
  }

  async cleanup(): Promise<void> {
    await this.db
      .deleteFrom('idempotency_keys')
      .where('expires_at', '<', new Date())
      .execute();
  }
}

// Usage in webhook handler
async function handleWebhook(
  source: string,
  eventId: string,
  payload: unknown
): Promise<WebhookResponse> {
  const idempotencyKey = `${source}:${eventId}`;

  const idempotency = new IdempotencyService(db);
  const acquired = await idempotency.checkAndLock(idempotencyKey);

  if (!acquired) {
    // Already processed - return cached response
    const cached = await idempotency.getResponse(idempotencyKey);
    return cached ?? { status: 'already_processed' };
  }

  try {
    const result = await processWebhook(payload);
    await idempotency.storeResponse(idempotencyKey, result);
    return result;
  } catch (error) {
    // Remove key on failure so it can be retried
    await db.deleteFrom('idempotency_keys')
      .where('key', '=', idempotencyKey)
      .execute();
    throw error;
  }
}
```

## Data Retention

```typescript
// Scheduled job for data cleanup
export async function cleanupOldData(): Promise<CleanupResult> {
  const now = new Date();

  // Archive events older than 2 years
  const eventsCutoff = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);

  // Archive completed appointments older than 6 months
  const appointmentsCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  // Clean up expired idempotency keys
  await db.deleteFrom('idempotency_keys')
    .where('expires_at', '<', now)
    .execute();

  // Soft delete old completed appointments
  await db.updateTable('appointments')
    .set({ notes: '[ARCHIVED]' })
    .where('status', '=', 'completed')
    .where('completed_at', '<', appointmentsCutoff)
    .execute();

  return {
    eventsArchived: 0,
    appointmentsArchived: 0,
    idempotencyKeysDeleted: 0,
  };
}
```

## Database Checklist

Before any database change:

- [ ] Migration file created with up AND down
- [ ] Migration tested on fresh database
- [ ] Migration rollback tested
- [ ] Indexes added for query patterns
- [ ] Foreign key constraints defined
- [ ] Repository methods updated
- [ ] Unit tests for repository
- [ ] Integration tests pass
