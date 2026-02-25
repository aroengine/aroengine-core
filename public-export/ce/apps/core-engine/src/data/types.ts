export type RiskCategory = 'low' | 'medium' | 'high';
export type PaymentStatus = 'current' | 'past_due' | 'no_history';
export type ReviewStatus = 'pending' | 'requested' | 'submitted' | 'none';
export type CommunicationPreference = 'sms' | 'whatsapp' | 'email';

export type AppointmentStatus =
  | 'booked'
  | 'confirmed'
  | 'rescheduled'
  | 'cancelled'
  | 'no_show'
  | 'completed'
  | 'in_progress';

export type ReminderType = '48h' | '24h' | '6h' | 'custom';
export type ReminderChannel = 'sms' | 'whatsapp' | 'email';

export type EventEntityType = 'customer' | 'appointment' | 'system';
export type EventActor = 'system' | 'user' | 'admin' | 'webhook';

export interface CustomerRecord {
  id: string;
  phone: string;
  email?: string;
  name?: string;
  noShowCount: number;
  rescheduleCount: number;
  cancelCount: number;
  confirmationRate: number;
  lifetimeValue: number;
  paymentStatus: PaymentStatus;
  depositsPaid: number;
  reviewStatus: ReviewStatus;
  lastReviewRequestDate?: string;
  communicationPreference: CommunicationPreference;
  riskScore: number;
  riskCategory: RiskCategory;
  requiresDeposit: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentRecord {
  id: string;
  externalId?: string;
  customerId: string;
  date: string;
  duration: number;
  serviceType: string;
  serviceCost: number;
  provider?: string;
  location?: string;
  status: AppointmentStatus;
  previousStatus: AppointmentStatus[];
  confirmationReceived: boolean;
  confirmationDate?: string;
  responseClassification?: 'confirmed' | 'reschedule' | 'cancel' | 'unclear';
  depositRequired: boolean;
  depositAmount?: number;
  depositPaid: boolean;
  depositPaymentId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  notes?: string;
}

export interface ReminderLogRecord {
  id: string;
  appointmentId: string;
  sentAt: string;
  type: ReminderType;
  channel: ReminderChannel;
  messageId?: string;
  delivered: boolean;
  read?: boolean;
  createdAt: string;
}

export interface EventRecord {
  id: string;
  timestamp: string;
  type: string;
  entityType: EventEntityType;
  entityId: string;
  actor: EventActor;
  actorId?: string;
  data: Record<string, unknown>;
  metadata: {
    source: string;
    version: string;
    ipAddress?: string;
  };
  replayCursor: string;
  createdAt: string;
}

export interface WorkflowInstanceRecord {
  id: string;
  workflowName: string;
  appointmentId: string;
  currentState: string;
  stateData: Record<string, unknown>;
  startedAt: string;
  lastUpdatedAt: string;
  completedAt?: string;
  failedAt?: string;
  retryCount: number;
  maxRetries: number;
  error?: {
    message: string;
    stack?: string;
    timestamp: string;
  };
  createdAt: string;
}

export interface BusinessConfigRecord {
  id: string;
  businessName: string;
  phone: string;
  email: string;
  address?: string;
  timezone: string;
  businessHours: Record<string, { open: string; close: string; closed: boolean }>;
  integrations: {
    booking?: {
      provider: string;
      apiKey: string;
      webhookUrl: string;
    };
    messaging?: {
      provider: string;
      apiKey: string;
      phoneNumber: string;
    };
    payment?: {
      provider: string;
      apiKey: string;
      publishableKey: string;
    };
  };
  rules: {
    depositThreshold: number;
    depositAmount: number;
    reminderTiming: string[];
    autoRebookingEnabled: boolean;
    reviewRequestDelay: number;
  };
  createdAt: string;
  updatedAt: string;
}