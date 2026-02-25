export interface DiagnosticsSnapshot {
  timestamp: string;
  service: string;
  status: 'healthy' | 'degraded';
  checks: Record<string, 'up' | 'down'>;
  metrics: {
    uptimeSeconds: number;
    memoryRssBytes: number;
  };
}

export function buildDiagnosticsSnapshot(input: {
  service: string;
  checks: Record<string, 'up' | 'down'>;
  uptimeSeconds: number;
  memoryRssBytes: number;
}): DiagnosticsSnapshot {
  const status = Object.values(input.checks).every((value) => value === 'up') ? 'healthy' : 'degraded';

  return {
    timestamp: new Date().toISOString(),
    service: input.service,
    status,
    checks: input.checks,
    metrics: {
      uptimeSeconds: input.uptimeSeconds,
      memoryRssBytes: input.memoryRssBytes,
    },
  };
}