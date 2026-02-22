# Workflow & Orchestration Specification
**Appointment Revenue Optimizer (ARO)**
Version: 1.0
Date: 2026-02-22

## 1. Overview

This specification defines the workflow engine, state machines, trigger system, and orchestration logic for ARO. The system is designed to be deterministic and rules-based, with AI/LLM components used only for communication tasks, not business logic.

### 1.1 Core and Vertical Profile Execution Model

- Workflows in this document are **Core Platform** workflows and are domain-agnostic.
- The current default profile is `healthcare`, which applies additional safety/compliance overlays.
- Future profiles (salon, legal consults, coaching, etc.) may override templates and policy overlays without changing core state machine contracts.

### 1.2 Core Engine Contract (ADR-0006)

- This document defines behavior executed by `core-engine` as an independent stateless service.
- Workflow transitions must be triggered through Command API command types and never via profile-specific branches in core logic.
- Workflow outcomes must be published as canonical events on Event API for profile backends to project/read.
- Profile-specific message copy and policy checks must be supplied by Profile Packs in profile backends before command submission.

### 1.3 OpenClaw Execution Plane Contract

- Side-effecting skill execution occurs in OpenClaw Executor under Core-authorized command types.
- Core Engine remains the deterministic source of truth for workflow transitions.
- OpenClaw results must be emitted as canonical events and re-enter deterministic transition flow.
- No direct state mutation from OpenClaw runtime outside command/event contracts.

## 2. Core Principles

### 2.1 Deterministic First
- Business logic encoded in state machines and rules
- Predictable behavior for debugging and compliance
- LLMs used only for tone, classification, and content generation

### 2.2 Event-Driven Architecture
- All state changes trigger events
- Workflows react to events
- Asynchronous processing with retry logic

### 2.3 Human-in-Loop
- Critical actions require confirmation
- Manual override always available
- Admin notifications for escalations

## 3. State Machines

### 3.1 Appointment State Machine

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

**State Transition Rules**:

```typescript
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ['confirmed', 'rescheduled', 'cancelled', 'no_show', 'in_progress'],
  confirmed: ['rescheduled', 'cancelled', 'in_progress', 'no_show'],
  rescheduled: ['booked'],
  in_progress: ['completed', 'no_show'],
  completed: [],  // Terminal state
  no_show: [],     // Terminal state
  cancelled: []    // Terminal state
};

function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
```

### 3.2 Workflow State Machine

```
Initial State: PENDING

States:
- PENDING: Workflow created, not yet started
- RUNNING: Currently executing
- WAITING: Waiting for external event (e.g., time trigger)
- RETRYING: Failed, attempting retry
- COMPLETED: Successfully finished
- FAILED: Permanently failed
- CANCELLED: Manually stopped

Transitions:
PENDING ──> RUNNING ──> WAITING ──> RUNNING ──> COMPLETED
              │            │
              │            └──(timeout)──> RETRYING ──> RUNNING
              │                                │
              └──(error)───────────────────────┘
                  │
                  └──(max retries)──> FAILED
```

## 4. Trigger System

### 4.0 Timezone Resolution (Mandatory)

All scheduled triggers must resolve timezone in this order:
1. `appointment.timezone` (if explicitly stored)
2. `customer.timezone` (if available)
3. `business_config.timezone`
4. `UTC` fallback

```typescript
function getEffectiveTimezone(
  appointment: { timezone?: string },
  customer: { timezone?: string },
  business: { timezone?: string }
): string {
  return appointment.timezone || customer.timezone || business.timezone || 'UTC';
}
```

**DST and Travel Rules**:
- Store appointment datetime in UTC and store the resolved IANA timezone used for scheduling.
- Evaluate time-based triggers using timezone-aware conversion at execution time.
- If customer timezone differs from business timezone, reminders follow appointment timezone.
- On reschedule, recompute timezone and all pending trigger offsets.

### 4.1 Trigger Types

#### Type 1: Event Triggers
Activated by system events.

**Trigger: booking_created**
```yaml
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

**Trigger: customer_response_received**
```yaml
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

#### Type 2: Time Triggers
Scheduled based on appointment time.

**Trigger: 48_hours_before**
```yaml
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

**Trigger: 24_hours_before**
```yaml
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

**Trigger: appointment_completed**
```yaml
trigger:
  type: time
  offset: +2h  # 2 hours after appointment
  reference: appointment.date + appointment.duration
  
conditions:
  - appointment.status == "completed"
  
actions:
  - skill: sendReviewRequest
    delay: 4h  # Total 6h after appointment
  - skill: sendRebookingMessage
    delay: 24h
```

#### Type 3: Pattern Triggers
Activated by behavioral patterns.

**Trigger: high_risk_pattern**
```yaml
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

**Trigger: no_show_occurred**
```yaml
trigger:
  type: event
  event: appointment.no_show
  
actions:
  - skill: updateCustomerRiskScore
  - skill: updateNoShowCount
  - skill: sendRebookingOffer
    params:
      requireDeposit: true
  - skill: notifyAdmin
```

### 4.2 Trigger Execution Engine

```typescript
interface Trigger {
  id: string;
  name: string;
  type: 'event' | 'time' | 'pattern';
  enabled: boolean;
  
  // Event trigger config
  event?: string;
  
  // Time trigger config
  offset?: string;  // e.g., "-48h", "+2h"
  reference?: string;  // Field path, e.g., "appointment.date"
  
  // Pattern trigger config
  pattern?: string;
  
  // Execution config
  conditions: Condition[];
  actions: Action[];
  priority: number;  // Lower = higher priority
}

interface Condition {
  field: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'NOT IN';
  value: any;
}

interface Action {
  skill: string;
  params?: Record<string, any>;
  delay?: string;  // e.g., "2h", "1d"
  retryOnFailure?: boolean;
  maxRetries?: number;
}

class TriggerEngine {
  async evaluateTrigger(trigger: Trigger, context: any): Promise<boolean> {
    for (const condition of trigger.conditions) {
      const fieldValue = this.getFieldValue(context, condition.field);
      if (!this.evaluateCondition(fieldValue, condition.operator, condition.value)) {
        return false;
      }
    }
    return true;
  }
  
  async executeTrigger(trigger: Trigger, context: any): Promise<void> {
    if (!await this.evaluateTrigger(trigger, context)) {
      return;
    }
    
    for (const action of trigger.actions) {
      if (action.delay) {
        await this.scheduleAction(action, context, action.delay);
      } else {
        await this.executeAction(action, context);
      }
    }
  }
  
  private async executeAction(action: Action, context: any): Promise<void> {
    const skill = this.skillRegistry.get(action.skill);
    const retries = action.maxRetries || 3;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await skill.run({...context, ...action.params});
        return;
      } catch (error) {
        if (attempt === retries) throw error;
        await this.wait(this.getBackoffDelay(attempt));
      }
    }
  }
}
```

## 5. Workflows

### 5.1 Reminder Sequence Workflow

```yaml
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
    skill: classifyCustomerResponse
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

### 5.2 Post-Appointment Workflow

```yaml
workflow:
  name: "post-appointment-engagement"
  version: "1.0"
  description: "Review request and rebooking after completed appointment"
  
triggers:
  - event: appointment.completed
  
steps:
  - id: wait_cooldown
    type: wait
    duration: "6h"
    nextStep: send_review_request
    
  - id: send_review_request
    skill: sendReviewRequest
    params:
      template: "review_request"
      reviewPlatforms: ["google", "yelp"]
    onSuccess: wait_for_review
    onFailure: log_and_continue
    
  - id: wait_for_review
    type: wait
    duration: "48h"
    events:
      - review.submitted
    onEvent: thank_for_review
    onTimeout: send_rebooking_message
    
  - id: thank_for_review
    skill: sendThankYouMessage
    onSuccess: send_rebooking_message
    
  - id: send_rebooking_message
    skill: sendRebookingOffer
    params:
      template: "rebook_offer"
      incentive: "10% off next visit"
    onSuccess: update_customer_ltv
    
  - id: update_customer_ltv
    skill: calculateLifetimeValue
    onSuccess: end
```

### 5.3 No-Show Recovery Workflow

```yaml
workflow:
  name: "no-show-recovery"
  version: "1.0"
  description: "Handle no-shows and attempt rebooking"
  
triggers:
  - event: appointment.no_show
  
steps:
  - id: update_customer_record
    skill: updateNoShowMetrics
    parallel:
      - skill: incrementNoShowCount
      - skill: calculateRiskScore
      - skill: logNoShowEvent
    onSuccess: check_risk_level
    
  - id: check_risk_level
    type: branch
    branches:
      - condition: "customer.riskScore >= 70"
        nextStep: flag_high_risk
      - default: send_rebooking_offer
        
  - id: flag_high_risk
    skill: flagCustomerHighRisk
    parallel:
      - skill: notifyAdmin
        params:
          reason: "high_risk_customer"
      - skill: requireDepositForFuture
    onSuccess: send_rebooking_with_deposit
    
  - id: send_rebooking_with_deposit
    skill: sendRebookingOffer
    params:
      template: "rebook_with_deposit"
      requireDeposit: true
    onSuccess: end
    
  - id: send_rebooking_offer
    skill: sendRebookingOffer
    params:
      template: "rebook_standard"
    onSuccess: end
```

### 5.4 Deposit Request Workflow

```yaml
workflow:
  name: "deposit-request"
  version: "1.0"
  description: "Request and track deposit payments"
  
triggers:
  - pattern: high_risk_detected
  - condition: appointment.depositRequired == true
  
steps:
  - id: generate_payment_link
    skill: createStripePaymentLink
    params:
      amount: "appointment.depositAmount || businessConfig.rules.depositAmount"
      description: "Appointment Deposit"
    onSuccess: send_deposit_request
    onFailure: notify_admin
    
  - id: send_deposit_request
    skill: sendDepositRequest
    params:
      template: "deposit_request"
      paymentLink: "{{paymentLink}}"
    onSuccess: wait_for_payment
    
  - id: wait_for_payment
    type: wait
    timeout: "24h"
    events:
      - payment.completed
    onEvent: mark_deposit_paid
    onTimeout: send_deposit_reminder
    
  - id: mark_deposit_paid
    skill: updateAppointmentDeposit
    params:
      depositPaid: true
    onSuccess: send_confirmation
    
  - id: send_deposit_reminder
    skill: sendDepositReminder
    onSuccess: wait_final_payment
    
  - id: wait_final_payment
    type: wait
    timeout: "12h"
    events:
      - payment.completed
    onEvent: mark_deposit_paid
    onTimeout: escalate_missing_deposit
    
  - id: escalate_missing_deposit
    skill: notifyAdmin
    params:
      reason: "deposit_not_paid"
      priority: "high"
    onSuccess: consider_cancellation
```

## 6. Skill Definitions

### 6.0 LLM Configuration Contract

LLM-backed skills must use explicit provider configuration (no implicit defaults):

```yaml
llm:
  provider: openai # openai | anthropic | local
  model: gpt-4o-mini
  max_tokens: 100
  temperature: 0.1
  timeout_ms: 4000
  monthly_cost_limit_usd: 100
```

**Operational Rules**:
- If monthly budget threshold is exceeded, fallback to deterministic keyword classifier.
- All LLM prompts/responses must be logged with redaction for PII-sensitive fields.

### 6.1 Core Skills

#### sendReminder
```typescript
export const sendReminder: Skill = {
  name: "sendReminder",
  version: "1.0",
  description: "Send appointment reminder message",
  
  inputs: {
    appointmentId: "string",
    type: "'48h' | '24h' | '6h'",
    template: "string"
  },
  
  outputs: {
    messageId: "string",
    delivered: "boolean"
  },
  
  async run(context: SkillContext): Promise<SkillResult> {
    const { appointmentId, type, template } = context.params;
    const appointment = await context.db.appointments.findById(appointmentId);
    const customer = await context.db.customers.findById(appointment.customerId);
    
    // Render template with variables
    const message = context.templates.render(template, {
      customerName: customer.name || "valued customer",
      appointmentDate: formatDate(appointment.date),
      appointmentTime: formatTime(appointment.date),
      serviceType: appointment.serviceType,
      businessName: context.config.businessName,
      businessPhone: context.config.phone
    });
    
    // Send via configured channel
    const result = await context.messaging.send({
      to: customer.phone,
      body: message,
      channel: customer.communicationPreference
    });
    
    // Log reminder
    await context.db.reminderLogs.create({
      appointmentId,
      sentAt: new Date(),
      type,
      channel: customer.communicationPreference,
      messageId: result.messageId,
      delivered: result.delivered
    });
    
    // Emit event
    await context.events.emit('reminder.sent', {
      appointmentId,
      customerId: customer.id,
      type,
      messageId: result.messageId
    });
    
    return {
      success: result.delivered,
      data: {
        messageId: result.messageId,
        delivered: result.delivered
      }
    };
  }
};
```

#### classifyCustomerResponse
```typescript
export const classifyCustomerResponse: Skill = {
  name: "classifyCustomerResponse",
  version: "1.0",
  description: "Classify customer response intent using LLM",
  
  inputs: {
    messageText: "string",
    appointmentId: "string"
  },
  
  outputs: {
    intent: "'confirmed' | 'reschedule' | 'cancel' | 'unclear'",
    confidence: "number"
  },
  
  async run(context: SkillContext): Promise<SkillResult> {
    const { messageText } = context.params;
    
    // LLM classification prompt
    const prompt = `
Classify the following customer response to an appointment reminder:

Customer message: "${messageText}"

Classify the intent as ONE of:
- confirmed: Customer confirms they will attend
- reschedule: Customer wants to change the time/date
- cancel: Customer wants to cancel
- unclear: Intent is not clear

Respond with JSON: {"intent": "<intent>", "confidence": <0-1>}
    `.trim();
    
    const response = await context.llm.complete({
      prompt,
      temperature: 0.1,
      maxTokens: 50
    });
    
    const classification = JSON.parse(response.text);
    
    // Log classification
    await context.db.appointments.update(context.params.appointmentId, {
      responseClassification: classification.intent
    });
    
    // Emit event
    await context.events.emit('response.classified', {
      appointmentId: context.params.appointmentId,
      intent: classification.intent,
      confidence: classification.confidence,
      originalText: messageText
    });
    
    return {
      success: true,
      data: classification
    };
  }
};
```

#### calculateRiskScore
```typescript
export const calculateRiskScore: Skill = {
  name: "calculateRiskScore",
  version: "1.0",
  description: "Calculate customer risk score",
  
  inputs: {
    customerId: "string"
  },
  
  outputs: {
    riskScore: "number",
    riskCategory: "string",
    requiresDeposit: "boolean"
  },
  
  async run(context: SkillContext): Promise<SkillResult> {
    const customer = await context.db.customers.findById(context.params.customerId);
    const appointments = await context.db.appointments.findByCustomerId(customer.id);
    
    let score = 0;
    
    // No-show history (max 40 points)
    score += Math.min(customer.noShowCount * 20, 40);
    
    // Confirmation rate (max 30 points)
    const confirmationRate = this.calculateConfirmationRate(appointments);
    score += (1 - confirmationRate) * 30;
    
    // Reschedule frequency (max 20 points)
    if (appointments.length > 0) {
      const rescheduleRatio = customer.rescheduleCount / appointments.length;
      score += rescheduleRatio * 20;
    }
    
    // Payment history (max 10 points)
    if (customer.paymentStatus === 'past_due') score += 10;
    
    const finalScore = Math.min(Math.round(score), 100);
    const category = this.getRiskCategory(finalScore);
    const requiresDeposit = finalScore >= context.config.rules.depositThreshold;
    
    // Update customer record
    await context.db.customers.update(customer.id, {
      riskScore: finalScore,
      riskCategory: category,
      requiresDeposit
    });
    
    // Emit event if category changed
    if (customer.riskCategory !== category) {
      await context.events.emit('customer.risk_score_changed', {
        customerId: customer.id,
        oldScore: customer.riskScore,
        newScore: finalScore,
        oldCategory: customer.riskCategory,
        newCategory: category
      });
    }
    
    return {
      success: true,
      data: {
        riskScore: finalScore,
        riskCategory: category,
        requiresDeposit
      }
    };
  },
  
  private calculateConfirmationRate(appointments: Appointment[]): number {
    if (appointments.length === 0) return 0;
    const confirmed = appointments.filter(apt => apt.confirmationReceived).length;
    return confirmed / appointments.length;
  },
  
  private getRiskCategory(score: number): string {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }
};
```

## 7. Execution & Retry Logic

### 7.1 Retry Policy

```typescript
interface RetryPolicy {
  maxAttempts: number;
  backoffStrategy: 'fixed' | 'exponential' | 'linear';
  initialDelay: number;  // milliseconds
  maxDelay: number;      // milliseconds
  retryOn: string[];     // Error codes/types to retry
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffStrategy: 'exponential',
  initialDelay: 1000,
  maxDelay: 30000,
  retryOn: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT']
};

// Note: This is the orchestration default.
// Provider-specific adapters may override retries (see API integrations spec).

async function executeWithRetry(
  fn: () => Promise<any>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Promise<any> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (!policy.retryOn.includes(error.code) || attempt === policy.maxAttempts) {
        throw error;
      }
      
      const delay = this.calculateBackoff(attempt, policy);
      await this.sleep(delay);
    }
  }
  
  throw lastError;
}

private calculateBackoff(attempt: number, policy: RetryPolicy): number {
  let delay: number;
  
  switch (policy.backoffStrategy) {
    case 'fixed':
      delay = policy.initialDelay;
      break;
    case 'linear':
      delay = policy.initialDelay * attempt;
      break;
    case 'exponential':
      delay = policy.initialDelay * Math.pow(2, attempt - 1);
      break;
  }
  
  return Math.min(delay, policy.maxDelay);
}
```

### 7.2 Dead Letter Queue

```typescript
interface DeadLetter {
  id: string;
  workflowId: string;
  skillName: string;
  context: any;
  error: {
    message: string;
    stack: string;
    code: string;
  };
  attempts: number;
  createdAt: Date;
  lastAttemptAt: Date;
}

class DeadLetterQueue {
  async add(item: DeadLetter): Promise<void> {
    await this.db.deadLetters.create(item);
    await this.notifyAdmin({
      type: 'dead_letter_added',
      item
    });
  }
  
  async retry(id: string): Promise<void> {
    const item = await this.db.deadLetters.findById(id);
    // Re-queue for processing
    await this.workflowEngine.execute(item.workflowId, item.context);
  }
  
  async archive(id: string): Promise<void> {
    await this.db.deadLetters.update(id, { archived: true });
  }
}
```

**DLQ Retention Policy**:
- Default retention: 30 days
- Purge job: daily at 02:30 local business time
- Compliance override allowed if legal retention policies require shorter windows

## 8. Guardrails & Safety

### 8.1 Safety Checks

```typescript
const GUARDRAILS = {
  // Never auto-cancel
  preventAutoCancellation: async (context: any) => {
    if (context.action === 'cancel_appointment' && context.actor === 'system') {
      throw new GuardrailViolation('Auto-cancellation not allowed');
    }
  },
  
  // Never auto-charge
  preventAutoPayment: async (context: any) => {
    if (context.action === 'charge_payment' && !context.userConfirmed) {
      throw new GuardrailViolation('Auto-payment requires user confirmation');
    }
  },
  
  // Rate limiting
  messageRateLimit: async (context: any) => {
    const customerId = context.customer.id;
    const count = await this.countMessagesToday(customerId);
    if (count >= 3) {
      throw new GuardrailViolation('Message rate limit exceeded');
    }
  },
  
  // No medical advice
  preventMedicalAdvice: async (context: any) => {
    if (context.messageType === 'llm_generated') {
      const message = context.message.toLowerCase();
      const medicalKeywords = ['diagnose', 'prescription', 'treatment', 'cure'];
      if (medicalKeywords.some(kw => message.includes(kw))) {
        throw new GuardrailViolation('Medical advice generation not allowed');
      }
    }
  }
};
```

### 8.2 Admin Escalation Rules

```typescript
const ESCALATION_RULES = [
  {
    condition: (context) => context.customer.riskScore >= 80,
    action: 'notify_admin',
    priority: 'high',
    message: 'Very high-risk customer detected'
  },
  {
    condition: (context) => context.workflow.retryCount >= 3,
    action: 'notify_admin',
    priority: 'medium',
    message: 'Workflow failed after 3 retries'
  },
  {
    condition: (context) => !context.customer.responded && hoursUntilAppt(context) <= 6,
    action: 'notify_admin',
    priority: 'high',
    message: 'No customer response within 6 hours of appointment'
  }
];
```

## 9. Monitoring & Observability

### 9.1 Workflow Metrics

```typescript
interface WorkflowMetrics {
  workflowName: string;
  totalExecutions: number;
  successRate: number;
  averageDuration: number;  // milliseconds
  failureReasons: Record<string, number>;
  lastExecuted: Date;
}
```

### 9.2 Skill Metrics

```typescript
interface SkillMetrics {
  skillName: string;
  executionCount: number;
  successRate: number;
  averageExecutionTime: number;
  retryRate: number;
  errorRate: number;
}
```

### 9.3 Logging

All workflow executions, skill invocations, and state transitions must be logged to the event store for audit and debugging.

---

**Document Control**
- Author: Engineering Team
- Reviewers: Product, Operations
- Approval Date: TBD
- Next Review: 60 days post-launch
