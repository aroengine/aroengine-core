import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CalendlyAdapter,
  InMemoryIdempotencyStore,
  StripeAdapter,
  TwilioAdapter,
  WebhookProcessor,
} from '../../index.js';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('Phase 4 integrations', () => {
  it('verifies Calendly webhook signatures and normalizes events', async () => {
    const secret = 'calendly-secret';
    const adapter = new CalendlyAdapter(secret);
    const rawPayload = JSON.stringify({ event_id: 'evt-1', event: 'appointment.created' });

    expect(adapter.verifySignature(rawPayload, sign(rawPayload, secret))).toBe(true);

    const normalized = await adapter.handleWebhook({
      event_id: 'evt-1',
      event: 'appointment.created',
      appointment_id: 'apt-1',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    expect(normalized.type).toBe('appointment.created');
    expect(normalized.entityId).toBe('apt-1');
  });

  it('normalizes Twilio and Stripe webhook payloads', async () => {
    const twilio = new TwilioAdapter('twilio-token');
    const stripe = new StripeAdapter('stripe-secret');

    const incoming = await twilio.handleIncomingWebhook({ MessageSid: 'SM123' });
    expect(incoming.type).toBe('message.received');

    const payment = await stripe.handleWebhook({ id: 'evt_1', type: 'payment_intent.succeeded' });
    expect(payment.type).toBe('payment_intent.succeeded');

    const rawPayload = JSON.stringify({ MessageSid: 'SM123' });
    expect(twilio.verifySignature(rawPayload, sign(rawPayload, 'twilio-token'))).toBe(true);
    expect(twilio.verifySignature(rawPayload, 'invalid')).toBe(false);

    const fallbackKey = twilio.getIdempotencyKey({ Foo: 'bar' });
    expect(fallbackKey.startsWith('twilio-')).toBe(true);

    const delivery = await twilio.handleDeliveryWebhook({});
    expect(delivery.entityId).toBe('unknown-message');
  });

  it('deduplicates webhooks using idempotency store', async () => {
    const processor = new WebhookProcessor({
      booking: new CalendlyAdapter('calendly-secret'),
      messaging: new TwilioAdapter('twilio-secret'),
      payment: new StripeAdapter('stripe-secret'),
      idempotency: new InMemoryIdempotencyStore(),
    });

    const first = await processor.process('stripe', {
      id: 'evt_same',
      type: 'payment_intent.succeeded',
      payment_intent: 'pi_1',
    });

    const duplicate = await processor.process('stripe', {
      id: 'evt_same',
      type: 'payment_intent.succeeded',
      payment_intent: 'pi_1',
    });

    expect(first.duplicate).toBe(false);
    expect(first.event?.type).toBe('payment_intent.succeeded');
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.event).toBeUndefined();
  });
});