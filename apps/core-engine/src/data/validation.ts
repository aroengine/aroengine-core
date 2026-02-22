import { z } from 'zod';

import { AppointmentStatus } from './types.js';

export const e164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be valid E.164 format');

export const customerInputSchema = z.object({
  phone: e164PhoneSchema,
  email: z.string().email().optional(),
  name: z.string().min(1).max(255).optional(),
  communicationPreference: z.enum(['sms', 'whatsapp', 'email']).default('sms'),
  riskScore: z.number().int().min(0).max(100).default(0),
  tags: z.array(z.string()).default([]),
});

export const appointmentInputSchema = z.object({
  customerId: z.string().uuid(),
  date: z
    .string()
    .datetime()
    .refine((value) => new Date(value).getTime() > Date.now(), {
      message: 'Date must be in the future',
    }),
  duration: z.number().int().positive(),
  serviceType: z.string().min(1).max(255),
  serviceCost: z.number().nonnegative(),
  provider: z.string().min(1).max(255).optional(),
  location: z.string().min(1).max(255).optional(),
  notes: z.string().max(2000).optional(),
});

export const allowedAppointmentTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ['confirmed', 'rescheduled', 'cancelled', 'no_show'],
  confirmed: ['in_progress', 'rescheduled', 'cancelled', 'no_show', 'completed'],
  rescheduled: ['booked'],
  cancelled: [],
  no_show: [],
  completed: [],
  in_progress: ['completed', 'cancelled'],
};

export function assertValidAppointmentTransition(
  fromStatus: AppointmentStatus,
  toStatus: AppointmentStatus,
): void {
  if (fromStatus === toStatus) {
    return;
  }

  const allowed = allowedAppointmentTransitions[fromStatus];
  if (!allowed.includes(toStatus)) {
    throw new Error(`Invalid appointment status transition: ${fromStatus} -> ${toStatus}`);
  }
}