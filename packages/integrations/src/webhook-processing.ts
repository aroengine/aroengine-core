import { BookingAdapter, MessagingAdapter, NormalizedEvent, PaymentAdapter } from './types.js';
import { stablePayloadHash } from './webhook-utils.js';

export interface StoredIdempotencyKey {
  key: string;
  source: string;
  payloadHash: string;
  expiresAt: string;
}

export class InMemoryIdempotencyStore {
  private readonly byKey = new Map<string, StoredIdempotencyKey>();

  exists(key: string): boolean {
    this.cleanupExpired();
    return this.byKey.has(key);
  }

  save(entry: StoredIdempotencyKey): void {
    this.byKey.set(entry.key, entry);
  }

  size(): number {
    this.cleanupExpired();
    return this.byKey.size;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.byKey.entries()) {
      if (new Date(value.expiresAt).getTime() < now) {
        this.byKey.delete(key);
      }
    }
  }
}

export interface WebhookProcessorDependencies {
  booking: BookingAdapter;
  messaging: MessagingAdapter;
  payment: PaymentAdapter;
  idempotency: InMemoryIdempotencyStore;
}

export class WebhookProcessor {
  constructor(private readonly dependencies: WebhookProcessorDependencies) {}

  async process(
    source: 'calendly' | 'twilio-incoming' | 'twilio-delivery' | 'stripe',
    payload: Record<string, unknown>,
  ): Promise<{ duplicate: boolean; event?: NormalizedEvent }> {
    const idempotencyKey = this.getIdempotencyKey(source, payload);
    if (this.dependencies.idempotency.exists(idempotencyKey)) {
      return { duplicate: true };
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    this.dependencies.idempotency.save({
      key: idempotencyKey,
      source,
      payloadHash: stablePayloadHash(payload),
      expiresAt,
    });

    const event = await this.normalize(source, payload);
    return {
      duplicate: false,
      event,
    };
  }

  private getIdempotencyKey(
    source: 'calendly' | 'twilio-incoming' | 'twilio-delivery' | 'stripe',
    payload: Record<string, unknown>,
  ): string {
    switch (source) {
      case 'calendly':
        return this.dependencies.booking.getIdempotencyKey(payload);
      case 'twilio-incoming':
      case 'twilio-delivery':
        return this.dependencies.messaging.getIdempotencyKey(payload);
      case 'stripe':
        return this.dependencies.payment.getIdempotencyKey(payload);
    }
  }

  private normalize(
    source: 'calendly' | 'twilio-incoming' | 'twilio-delivery' | 'stripe',
    payload: Record<string, unknown>,
  ): Promise<NormalizedEvent> {
    switch (source) {
      case 'calendly':
        return this.dependencies.booking.handleWebhook(payload);
      case 'twilio-incoming':
        return this.dependencies.messaging.handleIncomingWebhook(payload);
      case 'twilio-delivery':
        return this.dependencies.messaging.handleDeliveryWebhook(payload);
      case 'stripe':
        return this.dependencies.payment.handleWebhook(payload);
    }
  }
}