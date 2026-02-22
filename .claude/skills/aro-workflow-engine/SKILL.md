---
name: aro-workflow-engine
description: Implement deterministic workflow engine for ARO including state machines,
  triggers, skills, and orchestration. Based on docs/specs/03_workflow_orchestration.md.
  Use when building or modifying workflows, state machines, or automation logic.
---

# ARO Workflow Engine

Deterministic, production-grade workflow orchestration for the Appointment Revenue Optimizer.

## ADR-0006 Contract Rules (Mandatory)

Follow `docs/implementation/ADR-0006-core-engine-service-boundaries.md`:

- Implement workflow logic in `core-engine` as profile-agnostic deterministic transitions.
- Accept work only through Command API command types (not UI/profile-specific direct mutations).
- Emit canonical Event API envelopes for all significant workflow transitions.
- Reject profile-specific template/compliance logic in core; require profile backend Profile Pack preprocessing.
- Route side-effect execution through `openclaw-executor`; consume results as canonical events.

## Core Principles

### 1. Deterministic First
- Business logic encoded in state machines and rules
- Predictable behavior for debugging and compliance
- LLMs used ONLY for communication tasks, NOT business logic

### 2. Event-Driven Architecture
- All state changes trigger events
- Workflows react to events
- Asynchronous processing with retry logic

### 3. Human-in-Loop
- Critical actions require confirmation
- Manual override always available
- Admin notifications for escalations

## State Machines

### Appointment State Machine

```
Initial State: BOOKED

States:
- BOOKED: Appointment created, not yet confirmed
- CONFIRMED: Customer confirmed attendance
- RESCHEDULED: Date/time changed
- IN_PROGRESS: Appointment currently happening
- COMPLETED: Successfully finished
- NO_SHOW: Customer didn't attend
- CANCELLED: Appointment cancelled

Transitions:
┌──────────┐
│  BOOKED  │
└─────┬────┘
      │
      ├──(customer confirms)──────────────> CONFIRMED
      │
      ├──(customer requests change)────────> RESCHEDULED ──> BOOKED
      │
      ├──(customer cancels)─────────────────> CANCELLED
      │
      ├──(appointment time arrives)─────────> IN_PROGRESS ──> COMPLETED
      │
      └──(no confirmation + time passed)────> NO_SHOW
```

```typescript
// packages/workflow-engine/src/state-machines/appointment.ts

export type AppointmentStatus =
  | 'booked'
  | 'confirmed'
  | 'rescheduled'
  | 'cancelled'
  | 'no_show'
  | 'completed'
  | 'in_progress';

// Allowed transitions matrix
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ['confirmed', 'rescheduled', 'cancelled', 'no_show', 'in_progress'],
  confirmed: ['rescheduled', 'cancelled', 'in_progress', 'no_show'],
  rescheduled: ['booked'],
  in_progress: ['completed', 'no_show'],
  completed: [],      // Terminal state
  no_show: [],        // Terminal state
  cancelled: [],      // Terminal state
};

export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateTransition(
  from: AppointmentStatus,
  to: AppointmentStatus
): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(
      `Invalid appointment transition: ${from} -> ${to}`
    );
  }
}

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
  }
}
```

### Workflow State Machine

```typescript
// packages/workflow-engine/src/state-machines/workflow.ts

export type WorkflowState =
  | 'PENDING'    // Created, not started
  | 'RUNNING'    // Currently executing
  | 'WAITING'    // Waiting for external event
  | 'RETRYING'   // Failed, attempting retry
  | 'COMPLETED'  // Successfully finished
  | 'FAILED'     // Permanently failed
  | 'CANCELLED'; // Manually stopped

export interface WorkflowInstance {
  id: string;
  workflowName: string;
  appointmentId: string;
  currentState: WorkflowState;
  stateData: Record<string, unknown>;
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

## Trigger System

### Trigger Types

```typescript
// packages/workflow-engine/src/triggers/types.ts

export type TriggerType = 'event' | 'time' | 'pattern';

export interface Trigger {
  id: string;
  name: string;
  type: TriggerType;
  enabled: boolean;

  // Event trigger config
  event?: string;

  // Time trigger config
  offset?: string;      // e.g., "-48h", "+2h"
  reference?: string;   // Field path, e.g., "appointment.date"

  // Pattern trigger config
  pattern?: string;

  // Execution config
  conditions: Condition[];
  actions: Action[];
  priority: number;     // Lower = higher priority
}

export interface Condition {
  field: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'NOT IN';
  value: unknown;
}

export interface Action {
  skill: string;
  params?: Record<string, unknown>;
  delay?: string;         // e.g., "2h", "1d"
  retryOnFailure?: boolean;
  maxRetries?: number;
}
```

### Event Triggers

```yaml
# triggers/booking_created.yaml
trigger:
  type: event
  event: appointment.created

conditions:
  - appointment.status == "booked"

actions:
  - skill: sendConfirmationMessage
  - skill: scheduleReminderSequence
  - if: customer.riskScore >= 70
    then:
      - skill: requestDeposit
```

```yaml
# triggers/response_received.yaml
trigger:
  type: event
  event: message.received

actions:
  - skill: classifyResponse  # LLM-based
  - if: response.intent == "confirm"
    then:
      - skill: updateAppointmentStatus
        params: {status: "confirmed"}
  - if: response.intent == "reschedule"
    then:
      - skill: sendRescheduleLink
  - if: response.intent == "cancel"
    then:
      - skill: processCancellation
  - if: response.intent == "unclear"
    then:
      - skill: escalateToAdmin
```

### Time Triggers

```yaml
# triggers/48h_reminder.yaml
trigger:
  type: time
  offset: -48h
  reference: appointment.date

conditions:
  - appointment.status IN ["booked", "confirmed"]

actions:
  - skill: sendReminder
    params:
      type: "48h"
      template: "reminder_48h"
```

```yaml
# triggers/24h_reminder.yaml
trigger:
  type: time
  offset: -24h
  reference: appointment.date

conditions:
  - appointment.status == "booked"  # Not yet confirmed
  - appointment.confirmationReceived == false

actions:
  - skill: sendUrgentReminder
    params:
      type: "24h"
      template: "reminder_24h_urgent"
  - skill: escalateIfNoResponse
    delay: 2h
```

### Pattern Triggers

```yaml
# triggers/high_risk.yaml
trigger:
  type: pattern
  pattern: high_risk_detected

conditions:
  - customer.noShowCount >= 2
  OR
  - customer.riskScore >= 70

actions:
  - skill: forceDepositRequirement
  - skill: flagInAdminDashboard
  - skill: sendDepositRequest
    template: "deposit_required"
```

### Trigger Engine

```typescript
// packages/workflow-engine/src/triggers/engine.ts

export class TriggerEngine {
  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly db: Database
  ) {}

  async evaluateTrigger(
    trigger: Trigger,
    context: TriggerContext
  ): Promise<boolean> {
    for (const condition of trigger.conditions) {
      const fieldValue = this.getFieldValue(context, condition.field);
      if (!this.evaluateCondition(fieldValue, condition.operator, condition.value)) {
        return false;
      }
    }
    return true;
  }

  async executeTrigger(
    trigger: Trigger,
    context: TriggerContext
  ): Promise<TriggerResult> {
    // Check conditions
    if (!await this.evaluateTrigger(trigger, context)) {
      return { executed: false, reason: 'Conditions not met' };
    }

    // Execute actions
    const results: ActionResult[] = [];

    for (const action of trigger.actions) {
      try {
        if (action.delay) {
          // Schedule for later
          await this.scheduleAction(action, context, action.delay);
          results.push({ action: action.skill, status: 'scheduled' });
        } else {
          // Execute immediately
          const result = await this.executeAction(action, context);
          results.push({ action: action.skill, status: 'success', result });
        }
      } catch (error) {
        results.push({
          action: action.skill,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        // Stop on failure unless specified otherwise
        if (!action.retryOnFailure) {
          break;
        }
      }
    }

    return { executed: true, results };
  }

  private async executeAction(
    action: Action,
    context: TriggerContext
  ): Promise<unknown> {
    const skill = this.skillRegistry.get(action.skill);
    const retries = action.maxRetries ?? 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await skill.run({
          ...context,
          params: { ...action.params },
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        if (attempt < retries) {
          const delay = this.getBackoffDelay(attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  private evaluateCondition(
    fieldValue: unknown,
    operator: string,
    expectedValue: unknown
  ): boolean {
    switch (operator) {
      case '==':
        return fieldValue === expectedValue;
      case '!=':
        return fieldValue !== expectedValue;
      case '>':
        return (fieldValue as number) > (expectedValue as number);
      case '<':
        return (fieldValue as number) < (expectedValue as number);
      case '>=':
        return (fieldValue as number) >= (expectedValue as number);
      case '<=':
        return (fieldValue as number) <= (expectedValue as number);
      case 'IN':
        return (expectedValue as unknown[]).includes(fieldValue);
      case 'NOT IN':
        return !(expectedValue as unknown[]).includes(fieldValue);
      default:
        return false;
    }
  }

  private getFieldValue(context: TriggerContext, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private getBackoffDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s...
    const baseDelay = 1000;
    const delay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.1 * delay;
    return Math.min(delay + jitter, 30000); // Cap at 30s
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## Skills

### Skill Interface

```typescript
// packages/workflow-engine/src/skills/types.ts

export interface SkillContext {
  // Database access
  db: {
    customers: Repository<Customer>;
    appointments: Repository<Appointment>;
    events: Repository<Event>;
    reminderLogs: Repository<ReminderLog>;
    workflowInstances: Repository<WorkflowInstance>;
  };

  // External services
  messaging: MessagingAdapter;
  booking: BookingAdapter;
  payment: PaymentAdapter;

  // LLM access (limited use)
  llm: {
    complete(params: {
      prompt: string;
      temperature?: number;
      maxTokens?: number;
    }): Promise<{ text: string }>;
  };

  // Template rendering
  templates: {
    render(name: string, variables: Record<string, unknown>): string;
  };

  // Configuration
  config: BusinessConfig;

  // Event emitter
  events: {
    emit(type: string, data: unknown): Promise<void>;
  };

  // Logger
  logger: Logger;

  // Skill parameters
  params: Record<string, unknown>;
}

export interface SkillResult {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface Skill {
  name: string;
  version: string;
  description: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  run(context: SkillContext): Promise<SkillResult>;
}
```

### Core Skills Implementation

```typescript
// packages/workflow-engine/src/skills/sendReminder.ts

import { Skill, SkillContext, SkillResult } from './types';

export const sendReminder: Skill = {
  name: 'sendReminder',
  version: '1.0',
  description: 'Send appointment reminder message',

  inputs: {
    appointmentId: 'string',
    type: "'48h' | '24h' | '6h'",
    template: 'string',
  },

  outputs: {
    messageId: 'string',
    delivered: 'boolean',
  },

  async run(context: SkillContext): Promise<SkillResult> {
    const { appointmentId, type, template } = context.params as {
      appointmentId: string;
      type: '48h' | '24h' | '6h';
      template: string;
    };

    // Fetch appointment and customer
    const appointment = await context.db.appointments.findById(appointmentId);
    if (!appointment) {
      return {
        success: false,
        error: { code: 'APPOINTMENT_NOT_FOUND', message: `Appointment ${appointmentId} not found` },
      };
    }

    const customer = await context.db.customers.findById(appointment.customer_id);
    if (!customer) {
      return {
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      };
    }

    // Check customer message limit
    const sentToday = await context.db.reminderLogs.count({
      where: {
        customer_id: customer.id,
        sent_at: { gte: new Date(Date.now() - 86400000) },
      },
    });

    if (sentToday >= 3) {
      context.logger.warn('Customer message limit exceeded', { customerId: customer.id });
      return {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Customer message limit exceeded' },
      };
    }

    // Render message template
    const message = context.templates.render(template, {
      customerName: customer.name ?? 'valued customer',
      appointmentDate: formatDate(appointment.date),
      appointmentTime: formatTime(appointment.date),
      serviceType: appointment.service_type,
      businessName: context.config.business_name,
      businessPhone: context.config.phone,
    });

    // Check consent
    const consent = await context.db.consents.findByCustomerId(customer.id);
    if (!consent?.consent_given) {
      context.logger.warn('No consent for customer', { customerId: customer.id });
      return {
        success: false,
        error: { code: 'NO_CONSENT', message: 'Customer has not consented to messages' },
      };
    }

    try {
      // Send via configured channel
      const result = await context.messaging.send({
        to: customer.phone,
        body: message + '\n\nReply STOP to unsubscribe.',
        channel: customer.communication_preference,
      });

      // Log reminder
      await context.db.reminderLogs.create({
        appointment_id: appointmentId,
        sent_at: new Date(),
        type,
        channel: customer.communication_preference,
        message_id: result.messageId,
        delivered: result.delivered,
      });

      // Emit event
      await context.events.emit('reminder.sent', {
        appointmentId,
        customerId: customer.id,
        type,
        messageId: result.messageId,
      });

      return {
        success: result.delivered,
        data: {
          messageId: result.messageId,
          delivered: result.delivered,
        },
      };
    } catch (error) {
      context.logger.error('Failed to send reminder', { error, appointmentId });
      return {
        success: false,
        error: {
          code: 'SEND_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
```

### Response Classification Skill (LLM)

```typescript
// packages/workflow-engine/src/skills/classifyResponse.ts

import { Skill, SkillContext, SkillResult } from './types';

export const classifyResponse: Skill = {
  name: 'classifyResponse',
  version: '1.0',
  description: 'Classify customer response intent using LLM',

  inputs: {
    messageText: 'string',
    appointmentId: 'string',
  },

  outputs: {
    intent: "'confirmed' | 'reschedule' | 'cancel' | 'unclear'",
    confidence: 'number',
  },

  async run(context: SkillContext): Promise<SkillResult> {
    const { messageText, appointmentId } = context.params as {
      messageText: string;
      appointmentId: string;
    };

    // Check for opt-out keywords first (no LLM needed)
    const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    if (optOutKeywords.some(kw => messageText.toUpperCase().includes(kw))) {
      await processOptOut(context, messageText);
      return {
        success: true,
        data: { intent: 'cancel', confidence: 1.0 },
      };
    }

    // LLM classification prompt
    const prompt = `Classify the following customer response to an appointment reminder:

Customer message: "${messageText}"

Classify the intent as ONE of:
- confirmed: Customer confirms they will attend
- reschedule: Customer wants to change the time/date
- cancel: Customer wants to cancel
- unclear: Intent is not clear

Respond with JSON: {"intent": "<intent>", "confidence": <0-1>}`;

    try {
      const response = await context.llm.complete({
        prompt,
        temperature: 0.1,  // Low temperature for consistency
        maxTokens: 50,
      });

      const classification = JSON.parse(response.text);

      // Validate response
      const validIntents = ['confirmed', 'reschedule', 'cancel', 'unclear'];
      if (!validIntents.includes(classification.intent)) {
        classification.intent = 'unclear';
        classification.confidence = 0;
      }

      // Log classification
      await context.db.appointments.update(appointmentId, {
        response_classification: classification.intent,
      });

      // Emit event
      await context.events.emit('response.classified', {
        appointmentId,
        intent: classification.intent,
        confidence: classification.confidence,
        originalText: messageText,
      });

      return {
        success: true,
        data: classification,
      };
    } catch (error) {
      context.logger.error('Classification failed', { error, messageText });

      // Default to unclear on failure
      return {
        success: true,
        data: { intent: 'unclear', confidence: 0 },
      };
    }
  },
};

async function processOptOut(context: SkillContext, message: string): Promise<void> {
  // Implementation for opt-out processing
}
```

### Risk Score Calculation Skill

```typescript
// packages/workflow-engine/src/skills/calculateRiskScore.ts

import { Skill, SkillContext, SkillResult } from './types';

export const calculateRiskScore: Skill = {
  name: 'calculateRiskScore',
  version: '1.0',
  description: 'Calculate customer risk score (DETERMINISTIC - no LLM)',

  inputs: {
    customerId: 'string',
  },

  outputs: {
    riskScore: 'number',
    riskCategory: 'string',
    requiresDeposit: 'boolean',
  },

  async run(context: SkillContext): Promise<SkillResult> {
    const { customerId } = context.params as { customerId: string };

    const customer = await context.db.customers.findById(customerId);
    if (!customer) {
      return {
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      };
    }

    const appointments = await context.db.appointments.findByCustomerId(customerId);

    // DETERMINISTIC calculation (no LLM)
    let score = 0;

    // No-show history (max 40 points)
    score += Math.min(customer.no_show_count * 20, 40);

    // Confirmation rate (max 30 points)
    const confirmationRate = calculateConfirmationRate(appointments);
    score += (1 - confirmationRate) * 30;

    // Reschedule frequency (max 20 points)
    if (appointments.length > 0) {
      const rescheduleRatio = customer.reschedule_count / appointments.length;
      score += rescheduleRatio * 20;
    }

    // Payment history (max 10 points)
    if (customer.payment_status === 'past_due') {
      score += 10;
    }

    const finalScore = Math.min(Math.round(score), 100);
    const category = getRiskCategory(finalScore);
    const requiresDeposit = finalScore >= (context.config.rules?.depositThreshold ?? 70);

    // Update customer record
    await context.db.customers.update(customerId, {
      risk_score: finalScore,
      risk_category: category,
      requires_deposit: requiresDeposit,
    });

    // Emit event if category changed
    if (customer.risk_category !== category) {
      await context.events.emit('customer.risk_score_changed', {
        customerId,
        oldScore: customer.risk_score,
        newScore: finalScore,
        oldCategory: customer.risk_category,
        newCategory: category,
      });
    }

    return {
      success: true,
      data: {
        riskScore: finalScore,
        riskCategory: category,
        requiresDeposit,
      },
    };
  },
};

function calculateConfirmationRate(appointments: Appointment[]): number {
  if (appointments.length === 0) return 1;

  const confirmed = appointments.filter(apt =>
    apt.confirmation_received || apt.status === 'confirmed'
  ).length;

  return confirmed / appointments.length;
}

function getRiskCategory(score: number): 'low' | 'medium' | 'high' | 'blocked' {
  if (score >= 80) return 'blocked';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}
```

## Guardrails

```typescript
// packages/workflow-engine/src/guardrails/index.ts

export const GUARDRAILS = {
  // Never auto-cancel
  preventAutoCancellation: async (context: GuardrailContext): Promise<void> => {
    if (context.action === 'cancel_appointment' && context.actor === 'system') {
      throw new GuardrailViolation('Auto-cancellation not allowed');
    }
  },

  // Never auto-charge
  preventAutoPayment: async (context: GuardrailContext): Promise<void> => {
    if (context.action === 'charge_payment' && !context.userConfirmed) {
      throw new GuardrailViolation('Auto-payment requires user confirmation');
    }
  },

  // Rate limiting
  messageRateLimit: async (context: GuardrailContext): Promise<void> => {
    const customerId = context.customer?.id;
    if (!customerId) return;

    const count = await countMessagesToday(customerId);
    if (count >= 3) {
      throw new GuardrailViolation('Message rate limit exceeded');
    }
  },

  // No medical advice
  preventMedicalAdvice: async (context: GuardrailContext): Promise<void> => {
    if (context.messageType === 'llm_generated') {
      const message = context.message?.toLowerCase() ?? '';
      const medicalKeywords = ['diagnose', 'prescription', 'treatment', 'cure'];
      if (medicalKeywords.some(kw => message.includes(kw))) {
        throw new GuardrailViolation('Medical advice generation not allowed');
      }
    }
  },
};

export class GuardrailViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardrailViolation';
  }
}

async function runWithGuardrails(
  action: string,
  fn: () => Promise<unknown>,
  context: GuardrailContext
): Promise<unknown> {
  // Run all guardrails
  for (const guardrail of Object.values(GUARDRAILS)) {
    await guardrail({ ...context, action });
  }

  return fn();
}
```

## Workflow Orchestration

### Reminder Sequence Workflow

```yaml
# workflows/reminder-sequence.yaml
workflow:
  name: "appointment-reminder-sequence"
  version: "1.0"
  description: "Automated reminder sequence for appointments"

triggers:
  - event: appointment.created

steps:
  - id: initial_confirmation
    skill: sendConfirmationMessage
    onSuccess: schedule_48h_reminder
    onFailure: log_and_retry

  - id: schedule_48h_reminder
    skill: scheduleTimeBasedTrigger
    params:
      offset: "-48h"
      reference: "appointment.date"
      nextStep: send_48h_reminder

  - id: send_48h_reminder
    skill: sendReminder
    params:
      type: "48h"
      template: "reminder_48h"
    onSuccess: wait_for_confirmation

  - id: wait_for_confirmation
    type: wait
    timeout: "2h"
    events:
      - message.received
    onTimeout: schedule_24h_reminder
    onEvent: classify_response

  - id: classify_response
    skill: classifyResponse
    onSuccess: handle_response

  - id: handle_response
    type: branch
    branches:
      - condition: "response.intent == 'confirmed'"
        nextStep: mark_confirmed
      - condition: "response.intent == 'reschedule'"
        nextStep: handle_reschedule
      - condition: "response.intent == 'cancel'"
        nextStep: handle_cancellation
      - default: schedule_24h_reminder

  - id: mark_confirmed
    skill: updateAppointmentStatus
    params:
      status: "confirmed"
    onSuccess: end

  - id: schedule_24h_reminder
    skill: scheduleTimeBasedTrigger
    params:
      offset: "-24h"
      reference: "appointment.date"
      nextStep: send_24h_reminder

  - id: send_24h_reminder
    skill: sendUrgentReminder
    params:
      type: "24h"
      template: "reminder_24h_urgent"
    onSuccess: wait_final_confirmation

  - id: wait_final_confirmation
    type: wait
    timeout: "4h"
    events:
      - message.received
    onTimeout: escalate_to_admin
    onEvent: classify_response

  - id: escalate_to_admin
    skill: notifyAdmin
    params:
      reason: "no_customer_response"
      priority: "medium"
    onSuccess: end
```

## Workflow Checklist

Before deploying any workflow:

- [ ] State machine transitions validated
- [ ] Triggers properly configured
- [ ] Skills implemented and tested
- [ ] Guardrails in place
- [ ] Retry logic configured
- [ ] Escalation paths defined
- [ ] Audit logging enabled
- [ ] Error handling comprehensive
