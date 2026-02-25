import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildHealthcareProfileBackendApp,
  type HealthcareProfileAuthVerifier,
  type HealthcareProfileBackendConfig,
  healthcareProfileBackendServiceName,
  loadHealthcareProfileBackendConfig,
} from '../../index.js';

const config: HealthcareProfileBackendConfig = {
  NODE_ENV: 'test',
  PROFILE_BACKEND_HOST: '127.0.0.1',
  PROFILE_BACKEND_PORT: 4301,
  PROFILE_BACKEND_TENANT_ID: 'tenant-healthcare-test',
  PROFILE_BACKEND_SHARED_TOKEN: '1234567890abcdef',
  CORE_ENGINE_URL: 'http://localhost:4100',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'supabase-anon-key-test',
  PROFILE_BACKEND_ALLOWED_ROLES: ['admin', 'staff'],
};

const allowAdmin: HealthcareProfileAuthVerifier = async () => ({
  id: 'user-1',
  role: 'admin',
  email: 'admin@example.com',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('profile-backend-healthcare', () => {
  it('returns stable service name', () => {
    expect(healthcareProfileBackendServiceName()).toBe('profile-backend-healthcare');
  });

  it('loads and validates config', () => {
    const loaded = loadHealthcareProfileBackendConfig({
      NODE_ENV: 'test',
      PROFILE_BACKEND_HOST: '127.0.0.1',
      PROFILE_BACKEND_PORT: '4301',
      PROFILE_BACKEND_TENANT_ID: 'tenant-healthcare-test',
      PROFILE_BACKEND_SHARED_TOKEN: '1234567890abcdef',
      CORE_ENGINE_URL: 'http://localhost:4100',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'supabase-anon-key-test',
      PROFILE_BACKEND_ALLOWED_ROLES: 'admin,staff',
    });

    expect(loaded.PROFILE_BACKEND_PORT).toBe(4301);
    expect(loaded.PROFILE_BACKEND_TENANT_ID).toBe('tenant-healthcare-test');
  });

  it('exposes health and policy endpoints', async () => {
    const app = buildHealthcareProfileBackendApp(config, { verifyAccessToken: allowAdmin });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const policies = await app.inject({
      method: 'GET',
      url: '/v1/profile/healthcare/policies',
      headers: { authorization: 'Bearer user-token' },
    });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ service: 'profile-backend-healthcare', profile: 'healthcare' });
    expect(policies.statusCode).toBe(200);
    expect(policies.json()).toMatchObject({ profile: 'healthcare', preventAutoCancellation: true });
  });

  it('forwards send-reminder commands to core with tenant headers', async () => {
    const fetchMock = vi.fn(async () => ({
      status: 202,
      json: async () => ({ queued: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const app = buildHealthcareProfileBackendApp(config, { verifyAccessToken: allowAdmin });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/profile/healthcare/commands/send-reminder',
      headers: { authorization: 'Bearer user-token' },
      payload: {
        appointmentId: 'apt-1',
        customerPhone: '+15555555555',
        appointmentDate: '2026-01-01T10:00:00.000Z',
        serviceType: 'consultation',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4100/v1/commands',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-tenant-id': 'tenant-healthcare-test',
          authorization: 'Bearer 1234567890abcdef',
        }),
      }),
    );
  });

  it('rejects unauthenticated requests on profile endpoints', async () => {
    const app = buildHealthcareProfileBackendApp(config, { verifyAccessToken: allowAdmin });
    const response = await app.inject({ method: 'GET', url: '/v1/profile/healthcare/policies' });
    expect(response.statusCode).toBe(401);
  });
});