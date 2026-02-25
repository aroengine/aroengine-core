import { describe, expect, it } from 'vitest';

import {
  appointmentInputSchema,
  assertValidAppointmentTransition,
  customerInputSchema,
} from '../../data/validation.js';

describe('Phase 2 validation rules', () => {
  it('accepts valid E.164 customer phone', () => {
    const parsed = customerInputSchema.parse({
      phone: '+15551234567',
      communicationPreference: 'sms',
      riskScore: 35,
      tags: [],
    });

    expect(parsed.phone).toBe('+15551234567');
  });

  it('rejects invalid customer phone', () => {
    expect(() =>
      customerInputSchema.parse({
        phone: '5551234567',
        communicationPreference: 'sms',
        riskScore: 10,
        tags: [],
      }),
    ).toThrowError();
  });

  it('rejects appointment date in the past', () => {
    expect(() =>
      appointmentInputSchema.parse({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        date: new Date(Date.now() - 60_000).toISOString(),
        duration: 30,
        serviceType: 'Consult',
        serviceCost: 100,
      }),
    ).toThrowError(/Date must be in the future/);
  });

  it('enforces appointment transition graph', () => {
    expect(() => assertValidAppointmentTransition('booked', 'confirmed')).not.toThrowError();
    expect(() => assertValidAppointmentTransition('completed', 'booked')).toThrowError();
  });
});