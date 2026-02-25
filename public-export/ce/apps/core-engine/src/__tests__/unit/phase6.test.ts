import { describe, expect, it } from 'vitest';

import { MvpWorkflowService } from '../../server/phase6.js';

describe('Phase 6 MVP workflows', () => {
  it('ingests booking webhook idempotently by externalId', () => {
    const service = new MvpWorkflowService();
    const first = service.ingestBookingEvent({
      externalId: 'cal_evt_1',
      customerPhone: '+15551234567',
      appointmentDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      serviceType: 'Dental Cleaning',
    });
    const second = service.ingestBookingEvent({
      externalId: 'cal_evt_1',
      customerPhone: '+15551234567',
      appointmentDate: first.appointmentDate,
      serviceType: 'Dental Cleaning',
    });

    expect(first.id).toBe(second.id);
  });

  it('computes 48h and 24h reminder schedule', () => {
    const service = new MvpWorkflowService();
    const appointment = service.ingestBookingEvent({
      externalId: 'cal_evt_2',
      customerPhone: '+15551234567',
      appointmentDate: '2026-03-01T12:00:00.000Z',
      serviceType: 'Consultation',
    });

    const schedule = service.computeReminderSchedule(appointment.id);
    expect(schedule.reminder48hAt).toBe('2026-02-27T12:00:00.000Z');
    expect(schedule.reminder24hAt).toBe('2026-02-28T12:00:00.000Z');
  });

  it('classifies response with escalation on low confidence', () => {
    const service = new MvpWorkflowService();
    expect(service.classifyResponse('Yes I confirm').intent).toBe('confirmed');

    const unclear = service.classifyResponse('hmm maybe maybe');
    expect(unclear.intent).toBe('unclear');
    expect(unclear.escalated).toBe(true);
  });

  it('schedules review request 6 hours after appointment', () => {
    const service = new MvpWorkflowService();
    const appointment = service.ingestBookingEvent({
      externalId: 'cal_evt_3',
      customerPhone: '+15551234567',
      appointmentDate: '2026-03-01T12:00:00.000Z',
      serviceType: 'Follow-up',
    });

    const review = service.scheduleReviewRequest(appointment.id);
    expect(review.reviewRequestAt).toBe('2026-03-01T18:00:00.000Z');
  });
});