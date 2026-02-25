import { randomUUID } from 'node:crypto';

export interface BookingEventInput {
  externalId: string;
  customerPhone: string;
  appointmentDate: string;
  serviceType: string;
}

export interface AppointmentProjection {
  id: string;
  externalId: string;
  customerPhone: string;
  appointmentDate: string;
  serviceType: string;
  status: 'booked' | 'pending_confirm' | 'confirmed' | 'cancelled' | 'completed';
}

export interface ReminderSchedule {
  appointmentId: string;
  reminder48hAt: string;
  reminder24hAt: string;
}

export interface ClassificationResult {
  intent: 'confirmed' | 'reschedule' | 'cancel' | 'unclear';
  confidence: number;
  escalated: boolean;
}

export class MvpWorkflowService {
  private readonly appointments = new Map<string, AppointmentProjection>();

  ingestBookingEvent(input: BookingEventInput): AppointmentProjection {
    for (const appointment of this.appointments.values()) {
      if (appointment.externalId === input.externalId) {
        return appointment;
      }
    }

    const appointment: AppointmentProjection = {
      id: randomUUID(),
      externalId: input.externalId,
      customerPhone: input.customerPhone,
      appointmentDate: input.appointmentDate,
      serviceType: input.serviceType,
      status: 'pending_confirm',
    };

    this.appointments.set(appointment.id, appointment);
    return appointment;
  }

  computeReminderSchedule(appointmentId: string): ReminderSchedule {
    const appointment = this.requireAppointment(appointmentId);
    const appointmentTime = new Date(appointment.appointmentDate).getTime();

    return {
      appointmentId,
      reminder48hAt: new Date(appointmentTime - 48 * 60 * 60 * 1000).toISOString(),
      reminder24hAt: new Date(appointmentTime - 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  classifyResponse(message: string): ClassificationResult {
    const uppercase = message.toUpperCase();

    if (/\b(YES|CONFIRM|I WILL BE THERE)\b/.test(uppercase)) {
      return { intent: 'confirmed', confidence: 0.95, escalated: false };
    }

    if (/\b(RESCHEDULE|CHANGE|MOVE)\b/.test(uppercase)) {
      return { intent: 'reschedule', confidence: 0.9, escalated: false };
    }

    if (/\b(CANCEL|NO LONGER|CANNOT COME)\b/.test(uppercase)) {
      return { intent: 'cancel', confidence: 0.92, escalated: false };
    }

    return { intent: 'unclear', confidence: 0.2, escalated: true };
  }

  scheduleReviewRequest(appointmentId: string): { appointmentId: string; reviewRequestAt: string } {
    const appointment = this.requireAppointment(appointmentId);
    const appointmentTime = new Date(appointment.appointmentDate).getTime();
    return {
      appointmentId,
      reviewRequestAt: new Date(appointmentTime + 6 * 60 * 60 * 1000).toISOString(),
    };
  }

  listAppointments(): AppointmentProjection[] {
    return Array.from(this.appointments.values()).sort((left, right) =>
      left.appointmentDate.localeCompare(right.appointmentDate),
    );
  }

  metrics(): { totalAppointments: number; confirmed: number; cancelled: number } {
    const all = this.listAppointments();
    return {
      totalAppointments: all.length,
      confirmed: all.filter((item) => item.status === 'confirmed').length,
      cancelled: all.filter((item) => item.status === 'cancelled').length,
    };
  }

  private requireAppointment(appointmentId: string): AppointmentProjection {
    const appointment = this.appointments.get(appointmentId);
    if (appointment === undefined) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }

    return appointment;
  }
}