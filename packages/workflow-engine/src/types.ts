export type AppointmentStatus =
  | 'booked'
  | 'confirmed'
  | 'rescheduled'
  | 'cancelled'
  | 'no_show'
  | 'completed'
  | 'in_progress';

export type WorkflowState =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING'
  | 'RETRYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface WorkflowRuntimeInstance {
  id: string;
  workflowName: string;
  appointmentId: string;
  currentState: WorkflowState;
  stateData: Record<string, unknown>;
  startedAt: string;
  lastUpdatedAt: string;
  retryCount: number;
  maxRetries: number;
  completedAt?: string;
  failedAt?: string;
  error?: {
    message: string;
    code?: string;
    timestamp: string;
  };
}

export type TriggerType = 'event' | 'time' | 'pattern';
export type TriggerOperator = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'NOT IN';

export interface TriggerCondition {
  field: string;
  operator: TriggerOperator;
  value: unknown;
}

export interface TriggerAction {
  skill: string;
  params?: Record<string, unknown>;
  delayMs?: number;
  retryOnFailure?: boolean;
  maxRetries?: number;
}

export interface TriggerDefinition {
  id: string;
  name: string;
  type: TriggerType;
  enabled: boolean;
  event?: string;
  pattern?: string;
  offsetMs?: number;
  referenceField?: string;
  conditions: TriggerCondition[];
  actions: TriggerAction[];
  priority: number;
}

export interface TriggerContext {
  [key: string]: unknown;
}

export interface TriggerActionResult {
  action: string;
  status: 'success' | 'scheduled' | 'failed';
  error?: string;
  result?: unknown;
}

export interface TriggerExecutionResult {
  executed: boolean;
  reason?: string;
  results: TriggerActionResult[];
}

export interface DeadLetterEntry {
  id: string;
  workflowId: string;
  skillName: string;
  context: Record<string, unknown>;
  error: {
    code: string;
    message: string;
  };
  attempts: number;
  createdAt: string;
  lastAttemptAt: string;
  archived: boolean;
}

export interface GuardrailContext {
  action: string;
  actor: 'system' | 'user' | 'admin';
  userConfirmed?: boolean;
  customerId?: string;
  messageType?: 'llm_generated' | 'template';
  message?: string;
}

export interface EscalationContext {
  customerRiskScore: number;
  workflowRetryCount: number;
  hoursUntilAppointment: number;
  customerResponded: boolean;
}

export interface EscalationDecision {
  shouldEscalate: boolean;
  priority?: 'medium' | 'high';
  message?: string;
}