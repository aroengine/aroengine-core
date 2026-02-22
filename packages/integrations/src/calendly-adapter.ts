import { BookingAdapter, NormalizedEvent } from './types.js';
import { stablePayloadHash, verifyHmacSha256Signature } from './webhook-utils.js';

function getStringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

export class CalendlyAdapter implements BookingAdapter {
  constructor(private readonly webhookSecret: string) {}

  verifySignature(payload: string, signature: string): boolean {
    return verifyHmacSha256Signature(payload, signature, this.webhookSecret);
  }

  getIdempotencyKey(payload: Record<string, unknown>): string {
    const eventId = getStringField(payload, 'event_id');
    return eventId.length > 0 ? eventId : `calendly-${stablePayloadHash(payload)}`;
  }

  async handleWebhook(payload: Record<string, unknown>): Promise<NormalizedEvent> {
    const eventType = getStringField(payload, 'event') || 'appointment.updated';
    const entityId = getStringField(payload, 'appointment_id') || 'unknown-appointment';
    const occurredAt = getStringField(payload, 'created_at') || new Date().toISOString();

    return {
      type: eventType,
      entityId,
      occurredAt,
      source: 'calendly',
      payload,
    };
  }
}