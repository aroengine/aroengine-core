import { AppointmentStatus } from './types.js';

export const APPOINTMENT_ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ['confirmed', 'rescheduled', 'cancelled', 'no_show', 'in_progress'],
  confirmed: ['rescheduled', 'cancelled', 'in_progress', 'no_show'],
  rescheduled: ['booked'],
  in_progress: ['completed', 'no_show'],
  completed: [],
  no_show: [],
  cancelled: [],
};

export class InvalidAppointmentTransitionError extends Error {
  constructor(from: AppointmentStatus, to: AppointmentStatus) {
    super(`Invalid appointment transition: ${from} -> ${to}`);
    this.name = 'InvalidAppointmentTransitionError';
  }
}

export function canTransitionAppointment(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return APPOINTMENT_ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidAppointmentTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): void {
  if (!canTransitionAppointment(from, to)) {
    throw new InvalidAppointmentTransitionError(from, to);
  }
}