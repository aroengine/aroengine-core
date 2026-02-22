import { MessagingAdapter, NormalizedEvent } from './types.js';
import { stablePayloadHash, verifyHmacSha256Signature } from './webhook-utils.js';

function getStringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

export class TwilioAdapter implements MessagingAdapter {
  constructor(private readonly authToken: string) {}

  verifySignature(payload: string, signature: string): boolean {
    return verifyHmacSha256Signature(payload, signature, this.authToken);
  }

  getIdempotencyKey(payload: Record<string, unknown>): string {
    const messageSid = getStringField(payload, 'MessageSid');
    return messageSid.length > 0 ? messageSid : `twilio-${stablePayloadHash(payload)}`;
  }

  async handleIncomingWebhook(payload: Record<string, unknown>): Promise<NormalizedEvent> {
    return {
      type: 'message.received',
      entityId: getStringField(payload, 'MessageSid') || 'unknown-message',
      occurredAt: new Date().toISOString(),
      source: 'twilio',
      payload,
    };
  }

  async handleDeliveryWebhook(payload: Record<string, unknown>): Promise<NormalizedEvent> {
    return {
      type: 'reminder.delivered',
      entityId: getStringField(payload, 'MessageSid') || 'unknown-message',
      occurredAt: new Date().toISOString(),
      source: 'twilio',
      payload,
    };
  }
}