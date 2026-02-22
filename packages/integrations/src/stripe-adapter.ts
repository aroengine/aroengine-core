import { PaymentAdapter, NormalizedEvent } from './types.js';
import { stablePayloadHash, verifyHmacSha256Signature } from './webhook-utils.js';

function getStringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

export class StripeAdapter implements PaymentAdapter {
  constructor(private readonly webhookSecret: string) {}

  verifySignature(payload: string, signature: string): boolean {
    return verifyHmacSha256Signature(payload, signature, this.webhookSecret);
  }

  getIdempotencyKey(payload: Record<string, unknown>): string {
    const eventId = getStringField(payload, 'id');
    return eventId.length > 0 ? eventId : `stripe-${stablePayloadHash(payload)}`;
  }

  async handleWebhook(payload: Record<string, unknown>): Promise<NormalizedEvent> {
    const eventType = getStringField(payload, 'type') || 'deposit.unknown';
    const entityId =
      getStringField(payload, 'payment_intent') || getStringField(payload, 'id') || 'unknown-payment';

    return {
      type: eventType,
      entityId,
      occurredAt: new Date().toISOString(),
      source: 'stripe',
      payload,
    };
  }
}