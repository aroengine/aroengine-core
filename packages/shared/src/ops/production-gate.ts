export interface QualityGateResult {
  lint: boolean;
  typecheck: boolean;
  unitTests: boolean;
  integrationTests: boolean;
}

export interface PerformanceGateResult {
  webhookP95Ms: number;
  messageSendP95Ms: number;
}

export interface SecurityGateResult {
  webhookSignatureEnforced: boolean;
  secretsEncryptedAtRest: boolean;
  authEnabled: boolean;
  rateLimitEnabled: boolean;
}

export interface IncidentDrillResult {
  p0RunbookValidated: boolean;
  p1RunbookValidated: boolean;
}

export interface ProductionGateInput {
  quality: QualityGateResult;
  performance: PerformanceGateResult;
  security: SecurityGateResult;
  incidents: IncidentDrillResult;
}

export interface ProductionGateDecision {
  decision: 'GO' | 'NO-GO';
  reasons: string[];
}

export function evaluateProductionGate(input: ProductionGateInput): ProductionGateDecision {
  const reasons: string[] = [];

  if (!input.quality.lint || !input.quality.typecheck || !input.quality.unitTests || !input.quality.integrationTests) {
    reasons.push('Quality gates not fully green');
  }

  if (input.performance.webhookP95Ms > 2000) {
    reasons.push('Webhook P95 exceeds 2s target');
  }

  if (input.performance.messageSendP95Ms > 5000) {
    reasons.push('Message send P95 exceeds 5s target');
  }

  if (!input.security.webhookSignatureEnforced) {
    reasons.push('Webhook signature enforcement missing');
  }

  if (!input.security.secretsEncryptedAtRest) {
    reasons.push('Secrets are not encrypted at rest');
  }

  if (!input.security.authEnabled || !input.security.rateLimitEnabled) {
    reasons.push('Security runtime controls incomplete');
  }

  if (!input.incidents.p0RunbookValidated || !input.incidents.p1RunbookValidated) {
    reasons.push('Incident drills incomplete');
  }

  return {
    decision: reasons.length === 0 ? 'GO' : 'NO-GO',
    reasons,
  };
}