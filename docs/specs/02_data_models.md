# Data Models Specification
**Appointment Revenue Optimizer (ARO)**
Version: 1.0
Date: 2026-02-22

## 1. Overview

This document defines all data models, database schemas, and data structures used in the ARO system. All data is structured, not stored in LLM prompts.

### 1.1 Core vs Profile Data Model Policy

- All tables in this document are **Core Platform** data structures and are domain-agnostic.
- Vertical profiles (such as `healthcare`) apply additional validation/policy overlays without replacing core schemas.
- Profile-specific extensions should be additive (e.g., metadata or optional extension tables) and must not break Core workflows.

### 1.2 Data Ownership Boundaries (ADR-0006)

- Core Engine owns workflow state, command idempotency records, event/outbox records, and canonical audit linkage.
- Profile backends own profile read models/projections and profile-specific presentation metadata.
- Cross-service synchronization must use canonical Event API payloads; direct cross-database coupling is forbidden.
- Any schema needed only for profile UX must remain outside core execution invariants.

## 2. Core Data Models

### 2.1 Customer Model

```typescript
interface Customer {
  // Identity
  id: string;                    // UUID
  phone: string;                 // Primary identifier, E.164 format
  email?: string;                // Optional
  name?: string;                 // Optional, may be inferred
  
  // Behavioral Data
  appointmentHistory: string[];  // Array of appointment IDs
  noShowCount: number;           // Default: 0
  rescheduleCount: number;       // Default: 0
  cancelCount: number;           // Default: 0
  confirmationRate: number;      // % of confirmed appointments
  
  // Financial Data
  lifetimeValue: number;         // Total revenue from customer
  paymentStatus: 'current' | 'past_due' | 'no_history';
  depositsPaid: number;          // Count of deposits
  
  // Engagement Data
  reviewStatus: 'pending' | 'requested' | 'submitted' | 'none';
  lastReviewRequestDate?: Date;
  communicationPreference: 'sms' | 'whatsapp' | 'email';
  
  // Risk Assessment
  riskScore: number;             // 0-100, calculated
  riskCategory: 'low' | 'medium' | 'high' | 'blocked';
  requiresDeposit: boolean;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  tags: string[];                // Custom tags
}
```

**Database Schema (SQL)**:
```sql
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
```

### 2.2 Appointment Model

```typescript
interface Appointment {
  // Identity
  id: string;                    // UUID
  externalId?: string;           // ID from booking system
  customerId: string;            // FK to Customer
  
  // Appointment Details
  date: Date;                    // ISO 8601 datetime
  duration: number;              // Minutes
  serviceType: string;           // e.g., "Dental Cleaning", "Botox"
  serviceCost: number;           // Expected revenue
  provider?: string;             // Staff member name
  location?: string;             // For multi-location
  
  // State Management
  status: AppointmentStatus;
  previousStatus?: AppointmentStatus[];
  
  // Communication Tracking
  remindersSent: ReminderLog[];
  confirmationReceived: boolean;
  confirmationDate?: Date;
  responseClassification?: 'confirmed' | 'reschedule' | 'cancel' | 'unclear';
  
  // Financial
  depositRequired: boolean;
  depositAmount?: number;
  depositPaid: boolean;
  depositPaymentId?: string;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  notes?: string;
}

enum AppointmentStatus {
  BOOKED = 'booked',
  CONFIRMED = 'confirmed',
  RESCHEDULED = 'rescheduled',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
  COMPLETED = 'completed',
  IN_PROGRESS = 'in_progress'
}

interface ReminderLog {
  sentAt: Date;
  type: '48h' | '24h' | '6h' | 'custom';
  channel: 'sms' | 'whatsapp' | 'email';
  messageId: string;
  delivered: boolean;
  read?: boolean;
}
```

**Database Schema (SQL)**:
```sql
CREATE TYPE appointment_status AS ENUM (
  'booked', 'confirmed', 'rescheduled', 'cancelled', 'no_show', 'completed', 'in_progress'
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(255),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  
  date TIMESTAMP NOT NULL,
  duration INTEGER NOT NULL, -- minutes
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
```

### 2.3 Event Store Model

```typescript
interface Event {
  id: string;                    // UUID
  timestamp: Date;
  type: EventType;
  entityType: 'customer' | 'appointment' | 'system';
  entityId: string;
  
  actor: 'system' | 'user' | 'admin' | 'webhook';
  actorId?: string;
  
  data: Record<string, any>;     // Event-specific payload
  metadata: {
    source: string;              // e.g., "orchestrator", "webhook_handler"
    version: string;
    ipAddress?: string;
  };
}

enum EventType {
  // Appointment Events
  APPOINTMENT_CREATED = 'appointment.created',
  APPOINTMENT_CONFIRMED = 'appointment.confirmed',
  APPOINTMENT_RESCHEDULED = 'appointment.rescheduled',
  APPOINTMENT_CANCELLED = 'appointment.cancelled',
  APPOINTMENT_NO_SHOW = 'appointment.no_show',
  APPOINTMENT_COMPLETED = 'appointment.completed',
  
  // Communication Events
  REMINDER_SENT = 'reminder.sent',
  REMINDER_DELIVERED = 'reminder.delivered',
  MESSAGE_RECEIVED = 'message.received',
  RESPONSE_CLASSIFIED = 'response.classified',
  
  // Customer Events
  CUSTOMER_CREATED = 'customer.created',
  CUSTOMER_UPDATED = 'customer.updated',
  RISK_SCORE_CHANGED = 'customer.risk_score_changed',
  
  // Financial Events
  DEPOSIT_REQUESTED = 'deposit.requested',
  DEPOSIT_PAID = 'deposit.paid',
  
  // System Events
  WORKFLOW_STARTED = 'workflow.started',
  WORKFLOW_COMPLETED = 'workflow.completed',
  WORKFLOW_FAILED = 'workflow.failed',
  SKILL_EXECUTED = 'skill.executed',
  ERROR_OCCURRED = 'error.occurred'
}
```

**Database Schema (SQL)**:
```sql
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

-- PostgreSQL-only partitioning by month for scalability
-- (SQLite does not support native table partitioning)
-- Example:
-- CREATE TABLE events_y2026m02 PARTITION OF events
--   FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

**Engine-Specific Note**:
- SQLite (default self-hosted): use indexed time-based queries + archival jobs (no partitions).
- PostgreSQL (cloud/scale): enable monthly partitions for `events`.

### 2.4 Message Template Model

```typescript
interface MessageTemplate {
  id: string;
  name: string;
  category: 'reminder' | 'confirmation' | 'review' | 'deposit' | 'rebooking';
  channel: 'sms' | 'whatsapp' | 'email';
  
  subject?: string;              // For email
  body: string;                  // Template with variables
  variables: string[];           // e.g., ["name", "date", "service"]
  
  tone: 'professional' | 'friendly' | 'urgent';
  language: string;              // ISO 639-1 code
  
  active: boolean;
  version: number;
  
  createdAt: Date;
  updatedAt: Date;
}
```

**Database Schema (SQL)**:
```sql
CREATE TABLE message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  
  subject VARCHAR(255),
  body TEXT NOT NULL,
  variables TEXT[],
  
  tone VARCHAR(20) DEFAULT 'professional',
  language VARCHAR(10) DEFAULT 'en',
  
  active BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(name, version)
);

CREATE INDEX idx_template_category ON message_templates(category, active);
```

### 2.5 Workflow State Model

```typescript
interface WorkflowInstance {
  id: string;
  workflowName: string;
  appointmentId: string;
  
  currentState: string;
  stateData: Record<string, any>;
  
  startedAt: Date;
  lastUpdatedAt: Date;
  completedAt?: Date;
  failedAt?: Date;
  
  retryCount: number;
  maxRetries: number;
  
  error?: {
    message: string;
    stack: string;
    timestamp: Date;
  };
}
```

**Database Schema (SQL)**:
```sql
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
```

### 2.6 Business Configuration Model

```typescript
interface BusinessConfig {
  id: string;
  businessName: string;
  
  // Contact Info
  phone: string;
  email: string;
  address?: string;
  timezone: string;              // IANA timezone
  
  // Business Hours
  businessHours: {
    [key: string]: {             // day of week
      open: string;              // HH:MM
      close: string;             // HH:MM
      closed: boolean;
    };
  };
  
  // API Credentials (encrypted)
  integrations: {
    booking?: {
      provider: string;
      apiKey: string;            // Encrypted
      webhookUrl: string;
    };
    messaging?: {
      provider: string;
      apiKey: string;            // Encrypted
      phoneNumber: string;
    };
    payment?: {
      provider: string;
      apiKey: string;            // Encrypted
      publishableKey: string;
    };
  };
  
  // Business Rules
  rules: {
    depositThreshold: number;    // Risk score requiring deposit
    depositAmount: number;       // Default deposit amount
    reminderTiming: string[];    // e.g., ["48h", "24h"]
    autoRebookingEnabled: boolean;
    reviewRequestDelay: number;  // Hours after appointment
  };
  
  createdAt: Date;
  updatedAt: Date;
}
```

**Database Schema (SQL)**:
```sql
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
```

### 2.7 Consent Model (TCPA)

```typescript
interface Consent {
  id: string;
  customerId: string;
  phone: string;
  consentGiven: boolean;
  consentDate?: Date;
  consentMethod: 'web_form' | 'verbal' | 'booking_system' | 'imported';
  optOutDate?: Date;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Database Schema (SQL)**:
```sql
CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL,
  consent_given BOOLEAN NOT NULL DEFAULT FALSE,
  consent_date TIMESTAMP,
  consent_method VARCHAR(50) NOT NULL,
  opt_out_date TIMESTAMP,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consents_customer ON consents(customer_id);
CREATE INDEX idx_consents_phone ON consents(phone);
CREATE INDEX idx_consents_active ON consents(consent_given, opt_out_date);
```

### 2.8 Webhook Idempotency Key Model

```typescript
interface IdempotencyKey {
  key: string;
  source: string;
  payloadHash: string;
  createdAt: Date;
  expiresAt: Date;
}
```

**Database Schema (SQL)**:
```sql
CREATE TABLE idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  payload_hash VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);
```

## 3. Data Relationships

```
Customer (1) ──────< (Many) Appointment
   │                           │
   │                           │
   └──< Event                  └──< Event
                                │
                                └──< ReminderLog
                                │
                                └──< WorkflowInstance
```

## 4. Calculated Fields & Derivations

### 4.1 Risk Score Calculation

```typescript
function calculateRiskScore(customer: Customer): number {
  let score = 0;
  
  // No-show history (max 40 points)
  score += Math.min(customer.noShowCount * 20, 40);
  
  // Confirmation rate (max 30 points)
  score += (1 - customer.confirmationRate) * 30;
  
  // Reschedule frequency (max 20 points)
  if (customer.appointmentHistory.length > 0) {
    const rescheduleRatio = customer.rescheduleCount / customer.appointmentHistory.length;
    score += rescheduleRatio * 20;
  }
  
  // Payment history (max 10 points)
  if (customer.paymentStatus === 'past_due') score += 10;
  
  return Math.min(Math.round(score), 100);
}

function getRiskCategory(score: number): string {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}
```

**Risk Recalculation Triggers (Mandatory)**:
- After any appointment status change
- After any no-show/reschedule/cancel event
- Daily scheduled batch (`risk:recalculate --all`)
- Manual command (`risk:recalculate --customer <id>`)

### 4.2 Lifetime Value Calculation

```typescript
function calculateLTV(customer: Customer, appointments: Appointment[]): number {
  return appointments
    .filter(apt => apt.status === 'completed')
    .reduce((sum, apt) => sum + apt.serviceCost, 0);
}
```

### 4.3 Confirmation Rate

```typescript
function calculateConfirmationRate(appointments: Appointment[]): number {
  if (appointments.length === 0) return 0;
  
  const confirmed = appointments.filter(apt => 
    apt.confirmationReceived || apt.status === 'confirmed'
  ).length;
  
  return confirmed / appointments.length;
}
```

## 5. Data Validation Rules

### 5.1 Customer Validation
- Phone must be valid E.164 format
- Email must be valid format if provided
- Risk score must be 0-100
- Communication preference must be supported channel

### 5.2 Appointment Validation
- Date must be in the future (for new bookings)
- Duration must be > 0
- Service cost must be >= 0
- Status transitions must follow state machine rules

### 5.3 State Transition Rules

```
booked ─────> confirmed ─────> completed
  │              │                
  │              │                
  ├──> rescheduled ──────> booked
  │                         
  ├──> cancelled           
  │                        
  └──> no_show             
```

## 6. Data Retention & Archival

### 6.1 Active Data
- Current and future appointments: Indefinite
- Recent past appointments: 6 months

### 6.2 Historical Data
- Completed appointments: 2 years
- Customer records: While active + 2 years inactive
- Events: 3 years (partitioned by month)

### 6.3 Archival Strategy
- Monthly job archives data >2 years to cold storage
- Deletion requests processed within 30 days (GDPR)
- Soft deletes with `deleted_at` timestamp

## 7. Data Migration Strategy

### 7.1 Initial Import
- CSV import tool for existing customer data
- Booking system sync on first run
- Historical data optional

### 7.2 Schema Migrations
- Use migration tool (e.g., Flyway, Liquibase, db-migrate)
- Backwards compatible changes only
- Zero-downtime deployment strategy

## 8. Performance Optimization

### 8.1 Indexing Strategy
- Composite indexes for common queries
- Partial indexes for filtered queries
- JSONB GIN indexes for event/config queries

### 8.2 Caching
- Cache business config (TTL: 5 minutes)
- Cache customer risk scores (TTL: 1 hour)
- Cache message templates (TTL: 1 day)

### 8.3 Partitioning
- PostgreSQL: events table partitioned by month
- SQLite: no partitioning; rely on time indexes + archival windows
- Automatic archival/partition maintenance via scheduled job

## 9. Data Security

### 9.1 Encryption
- Sensitive fields encrypted at application layer (API keys)
- Database encryption at rest
- TLS for data in transit

### 9.2 Access Control
- Row-level security for multi-tenant (future)
- API credential encryption keys in environment variables
- No credentials in code or version control

### 9.3 PII Handling
- Phone numbers hashed for analytics
- Name and email optional
- Audit log for all PII access

---

## Appendix A: Sample Data

### Sample Customer
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "phone": "+15551234567",
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "noShowCount": 0,
  "rescheduleCount": 1,
  "cancelCount": 0,
  "confirmationRate": 0.90,
  "lifetimeValue": 450.00,
  "paymentStatus": "current",
  "depositsPaid": 0,
  "reviewStatus": "none",
  "communicationPreference": "sms",
  "riskScore": 15,
  "riskCategory": "low",
  "requiresDeposit": false,
  "createdAt": "2026-01-15T10:00:00Z",
  "updatedAt": "2026-02-20T14:30:00Z",
  "tags": ["regular", "dental-cleanings"]
}
```

### Sample Appointment
```json
{
  "id": "660f9511-f39c-52e5-b827-557766551111",
  "externalId": "cal_abc123",
  "customerId": "550e8400-e29b-41d4-a716-446655440000",
  "date": "2026-03-15T14:00:00Z",
  "duration": 60,
  "serviceType": "Dental Cleaning",
  "serviceCost": 150.00,
  "provider": "Dr. Smith",
  "status": "confirmed",
  "confirmationReceived": true,
  "confirmationDate": "2026-03-13T09:15:00Z",
  "depositRequired": false,
  "depositPaid": false,
  "createdAt": "2026-02-20T12:00:00Z",
  "updatedAt": "2026-03-13T09:15:00Z"
}
```

---

**Document Control**
- Author: Data Team
- Reviewers: Engineering, Security
- Approval Date: TBD
- Next Review: 60 days post-launch
