import { EscalationContext, EscalationDecision, GuardrailContext } from './types.js';

export class GuardrailViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardrailViolationError';
  }
}

const medicalAdvicePatterns = [
  /\bdiagnos(e|is|tic)\b/i,
  /\bprescript(ion|ive)\b/i,
  /\btreat(ment|ed|ing)\b/i,
  /\bcure(s|d)?\b/i,
];

export function enforceGuardrails(context: GuardrailContext): void {
  if (context.action === 'cancel_appointment' && context.actor === 'system') {
    throw new GuardrailViolationError('Auto-cancellation not allowed');
  }

  if (context.action === 'charge_payment' && context.userConfirmed !== true) {
    throw new GuardrailViolationError('Auto-payment requires user confirmation');
  }

  if (context.messageType === 'llm_generated' && context.message !== undefined) {
    const containsMedicalAdvice = medicalAdvicePatterns.some((pattern) => pattern.test(context.message!));
    if (containsMedicalAdvice) {
      throw new GuardrailViolationError('Medical advice generation is prohibited');
    }
  }
}

export function evaluateEscalation(context: EscalationContext): EscalationDecision {
  if (context.customerRiskScore >= 80) {
    return {
      shouldEscalate: true,
      priority: 'high',
      message: 'Very high-risk customer detected',
    };
  }

  if (context.workflowRetryCount >= 3) {
    return {
      shouldEscalate: true,
      priority: 'medium',
      message: 'Workflow failed after 3 retries',
    };
  }

  if (!context.customerResponded && context.hoursUntilAppointment <= 6) {
    return {
      shouldEscalate: true,
      priority: 'high',
      message: 'No customer response within 6 hours of appointment',
    };
  }

  return { shouldEscalate: false };
}