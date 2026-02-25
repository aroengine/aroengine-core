import { describe, expect, it } from 'vitest';

import { buildOpenclawExecutorApp } from '../../index.js';

const testEnv = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3200',
  OPENCLAW_SHARED_TOKEN: 'openclaw-shared-token-test',
  OPENCLAW_PERMISSION_MANIFEST_VERSION: '1.0.0',
  OPENCLAW_ALLOWED_COMMANDS: 'integration.twilio.send_sms,integration.payments.generate_deposit_link',
  OPENCLAW_ALLOWED_TENANTS: 'tenant-1,tenant-2',
  OPENCLAW_TENANT_RATE_LIMIT_PER_MINUTE: '100',
  OPENCLAW_IDEMPOTENCY_STORE_FILE: '/tmp/aro-openclaw-executor-idempotency-test.json',
  OPENCLAW_OUTBOX_FILE: '/tmp/aro-openclaw-executor-outbox-test.json',
  OPENCLAW_RUNTIME_MODE: 'external_cli',
  OPENCLAW_AGENT_ID: 'aro-executor-agent',
  OPENCLAW_AGENT_TIMEOUT_SECONDS: '30',
  OPENCLAW_AGENT_LOCAL_MODE: 'true',
} as const;

describe('openclaw-executor integration', () => {
  it('rejects unauthorized execution requests', async () => {
    const { app } = buildOpenclawExecutorApp(testEnv);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      payload: {
        executionId: '00000000-0000-4000-8000-000000000123',
        tenantId: 'tenant-1',
        correlationId: 'corr-1',
        commandType: 'integration.twilio.send_sms',
        authorizedByCore: true,
        permissionManifestVersion: '1.0.0',
        payload: { to: '+15551234567' },
      },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('enforces allowed command manifest and idempotent execution', async () => {
    const { app } = buildOpenclawExecutorApp(testEnv, {
      openclawCliRunner: async () => ({
        stdout: JSON.stringify({ ok: true, source: 'test-runner' }),
        stderr: '',
      }),
    });

    const denied = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: {
        authorization: `Bearer ${testEnv.OPENCLAW_SHARED_TOKEN}`,
        'x-tenant-id': 'tenant-1',
      },
      payload: {
        executionId: '00000000-0000-4000-8000-000000000124',
        tenantId: 'tenant-1',
        correlationId: 'corr-1',
        commandType: 'integration.booking.request_reschedule_link',
        authorizedByCore: true,
        permissionManifestVersion: '1.0.0',
        payload: { appointmentId: 'apt-1' },
      },
    });
    expect(denied.statusCode).toBe(403);

    const payload = {
      executionId: '00000000-0000-4000-8000-000000000125',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      commandType: 'integration.twilio.send_sms',
      authorizedByCore: true,
      permissionManifestVersion: '1.0.0',
      payload: { to: '+15551234567' },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: {
        authorization: `Bearer ${testEnv.OPENCLAW_SHARED_TOKEN}`,
        'x-tenant-id': 'tenant-1',
      },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: {
        authorization: `Bearer ${testEnv.OPENCLAW_SHARED_TOKEN}`,
        'x-tenant-id': 'tenant-1',
      },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().eventId).toBe(first.json().eventId);
    expect(first.json().payload.openclawRuntimeMode).toBe('external_cli');
    expect(first.json().payload.openclawAgentId).toBe(testEnv.OPENCLAW_AGENT_ID);
    expect(first.json().payload.openclawOutput.ok).toBe(true);

    await app.close();
  });

  it('executes commands via OpenClaw gateway tools invoke mode', async () => {
    const gatewayEnv = {
      ...testEnv,
      OPENCLAW_RUNTIME_MODE: 'gateway_tools_invoke',
      OPENCLAW_GATEWAY_URL: 'http://127.0.0.1:4100',
      OPENCLAW_GATEWAY_TOKEN: 'gateway-token',
      OPENCLAW_GATEWAY_TOOL_MAPPINGS:
        '{"integration.twilio.send_sms":{"tool":"twilio_tool","action":"send_sms"},"integration.payments.generate_deposit_link":{"tool":"payments_tool","action":"generate_deposit_link"}}',
    };

    const { app } = buildOpenclawExecutorApp(gatewayEnv, {
      openclawGatewayToolInvoker: async () => ({ ok: true, mode: 'gateway' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: {
        authorization: `Bearer ${testEnv.OPENCLAW_SHARED_TOKEN}`,
        'x-tenant-id': 'tenant-1',
      },
      payload: {
        executionId: '00000000-0000-4000-8000-000000000126',
        tenantId: 'tenant-1',
        correlationId: 'corr-1',
        commandType: 'integration.twilio.send_sms',
        authorizedByCore: true,
        permissionManifestVersion: '1.0.0',
        payload: { to: '+15551234567', body: 'hello' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().payload.openclawRuntimeMode).toBe('gateway_tools_invoke');
    expect(response.json().payload.openclawGatewayTool).toBe('twilio_tool');
    expect(response.json().payload.openclawGatewayAction).toBe('send_sms');
    expect(response.json().payload.openclawOutput.ok).toBe(true);

    await app.close();
  });

  it('rejects disallowed tenants and tenant mismatch', async () => {
    const { app } = buildOpenclawExecutorApp(testEnv, {
      openclawCliRunner: async () => ({
        stdout: JSON.stringify({ ok: true }),
        stderr: '',
      }),
    });

    const disallowedTenant = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: {
        authorization: `Bearer ${testEnv.OPENCLAW_SHARED_TOKEN}`,
        'x-tenant-id': 'tenant-not-allowed',
      },
      payload: {
        executionId: '00000000-0000-4000-8000-000000000129',
        tenantId: 'tenant-not-allowed',
        correlationId: 'corr-1',
        commandType: 'integration.twilio.send_sms',
        authorizedByCore: true,
        permissionManifestVersion: '1.0.0',
        payload: { to: '+15551234567' },
      },
    });

    expect(disallowedTenant.statusCode).toBe(403);

    const tenantMismatch = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: {
        authorization: `Bearer ${testEnv.OPENCLAW_SHARED_TOKEN}`,
        'x-tenant-id': 'tenant-2',
      },
      payload: {
        executionId: '00000000-0000-4000-8000-000000000130',
        tenantId: 'tenant-1',
        correlationId: 'corr-1',
        commandType: 'integration.twilio.send_sms',
        authorizedByCore: true,
        permissionManifestVersion: '1.0.0',
        payload: { to: '+15551234567' },
      },
    });

    expect(tenantMismatch.statusCode).toBe(400);
    await app.close();
  });
});
