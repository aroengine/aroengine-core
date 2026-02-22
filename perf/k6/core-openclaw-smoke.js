import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
  scenarios: {
    health_probe: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      exec: 'healthProbe',
    },
    executor_contract: {
      executor: 'constant-vus',
      vus: 2,
      duration: '30s',
      exec: 'executorContract',
      startTime: '2s',
    },
  },
};

const coreBaseUrl = __ENV.CORE_BASE_URL || 'http://127.0.0.1:3100';
const executorBaseUrl = __ENV.OPENCLAW_BASE_URL || 'http://127.0.0.1:3200';
const executorToken = __ENV.OPENCLAW_SHARED_TOKEN || 'openclaw-shared-token-test';
const manifestVersion = __ENV.OPENCLAW_PERMISSION_MANIFEST_VERSION || '1.0.0';

export function healthProbe() {
  const response = http.get(`${coreBaseUrl}/health`);
  check(response, {
    'core /health returns 200': (res) => res.status === 200,
  });
  sleep(1);
}

export function executorContract() {
  const executionId = `00000000-0000-4000-8000-${Math.floor(Math.random() * 1e12)
    .toString()
    .padStart(12, '0')}`;

  const payload = {
    executionId,
    tenantId: 'tenant-k6',
    correlationId: `corr-${executionId}`,
    commandType: 'integration.twilio.send_sms',
    authorizedByCore: true,
    permissionManifestVersion: manifestVersion,
    payload: { to: '+15551234567' },
  };

  const response = http.post(`${executorBaseUrl}/v1/executions`, JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${executorToken}`,
    },
  });

  check(response, {
    'executor /v1/executions returns 200': (res) => res.status === 200,
  });

  sleep(1);
}
