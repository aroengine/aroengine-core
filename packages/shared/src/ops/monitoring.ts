export interface AlertRule {
  name: string;
  severity: 'warning' | 'critical';
  condition: string;
}

export function defaultAlertRules(): AlertRule[] {
  return [
    {
      name: 'webhook-latency-p95',
      severity: 'critical',
      condition: 'p95_webhook_processing_ms > 2000 for 5m',
    },
    {
      name: 'message-send-latency-p95',
      severity: 'warning',
      condition: 'p95_message_send_ms > 5000 for 10m',
    },
    {
      name: 'error-rate-high',
      severity: 'critical',
      condition: 'error_rate > 0.05 for 5m',
    },
  ];
}

export function defaultRunbookEntries(): Array<{ incident: string; action: string }> {
  return [
    {
      incident: 'provider-outage',
      action: 'Enable fallback queue and verify circuit breaker state',
    },
    {
      incident: 'webhook-signature-failures',
      action: 'Verify secrets rotation and provider webhook signature headers',
    },
    {
      incident: 'high-no-show-spike',
      action: 'Review reminder delivery and confirmation classification metrics',
    },
  ];
}