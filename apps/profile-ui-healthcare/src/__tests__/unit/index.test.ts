import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthcareProfileClient, healthcareProfileUiServiceName } from '../../index.js';

const tokenProvider = async () => 'user-access-token';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('profile-ui-healthcare', () => {
  it('returns stable service name', () => {
    expect(healthcareProfileUiServiceName()).toBe('profile-ui-healthcare');
  });

  it('fetches and parses healthcare policies', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        profile: 'healthcare',
        reminderTemplateId: 'reminder_48h',
        maxMessagesPerDay: 3,
        preventAutoCancellation: true,
        preventAutoPayment: true,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new HealthcareProfileClient('http://localhost:4301', {
      accessTokenProvider: tokenProvider,
    });
    const policies = await client.getPolicies();

    expect(policies.profile).toBe('healthcare');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4301/v1/profile/healthcare/policies',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer user-access-token',
        }),
      }),
    );
  });

  it('sends reminder commands through backend profile API', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ queued: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new HealthcareProfileClient('http://localhost:4301', {
      accessTokenProvider: tokenProvider,
    });
    const response = await client.sendReminder({
      appointmentId: 'apt-1',
      customerPhone: '+15555555555',
      appointmentDate: '2026-01-01T10:00:00.000Z',
      serviceType: 'consultation',
    });

    expect(response).toEqual({ queued: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4301/v1/profile/healthcare/commands/send-reminder',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer user-access-token',
        }),
      }),
    );
  });
});