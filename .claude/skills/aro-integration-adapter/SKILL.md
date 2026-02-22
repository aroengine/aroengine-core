---
name: aro-integration-adapter
description: Implement external API integration adapters for ARO including Calendly,
  Twilio, and Stripe. Based on docs/specs/04_api_integrations.md. Use when building
  or modifying integrations with external services.
---

# ARO Integration Adapters

Production-grade external API integration patterns for the Appointment Revenue Optimizer.

## ADR-0006 Boundary Rules (Mandatory)

Reference: `docs/implementation/ADR-0006-core-engine-service-boundaries.md`

- External integrations are invoked by profile backends or core-engine integration modules, never directly by profile UI.
- Adapter outcomes that affect workflow state must be represented as Command API submissions or Event API publications.
- Adapter payload normalization must preserve canonical command/event schemas.
- Profile-specific adapter behavior must be additive in Profile Packs and cannot alter core envelope contracts.
- OpenClaw-powered side effects must execute in `openclaw-executor` and return canonical event results.

## Adapter Architecture

```
┌─────────────────────────────────────────┐
│        External Services                │
│  (Calendly, Twilio, Stripe)             │
└────────────────┬────────────────────────┘
                 │
         ┌───────▼────────┐
         │ Integration    │
         │ Adapters       │
         │ (Normalized)   │
         └───────┬────────┘
                 │
         ┌───────▼────────┐
         │ ARO Core       │
         │ (Business      │
         │  Logic)        │
         └────────────────┘
```

## Adapter Interface Contracts

### Booking Adapter

```typescript
// packages/integrations/src/booking/types.ts

export interface BookingAppointment {
  id: string;
  externalId: string;
  customer: {
    name: string | null;
    phone: string;
    email: string | null;
  };
  scheduledAt: Date;
  duration: number;        // minutes
  serviceType: string;
  status: 'booked' | 'confirmed' | 'cancelled' | 'rescheduled';
  notes?: string;
}

export interface BookingAdapter {
  // Fetch appointments in date range
  fetchAppointments(params: {
    startDate: Date;
    endDate: Date;
    status?: 'booked' | 'confirmed' | 'cancelled';
  }): Promise<BookingAppointment[]>;

  // Update appointment status
  updateAppointment(id: string, data: {
    status?: string;
    notes?: string;
  }): Promise<BookingAppointment>;

  // Handle incoming webhook
  handleWebhook(payload: unknown, signature: string): Promise<BookingAppointment>;

  // Verify webhook signature
  verifySignature(payload: string, signature: string): boolean;

  // Normalize external data to internal format
  normalizeAppointment(external: unknown): BookingAppointment;
}
```

### Messaging Adapter

```typescript
// packages/integrations/src/messaging/types.ts

export interface SendMessageParams {
  to: string;              // E.164 format
  body: string;
  channel?: 'sms' | 'whatsapp';
}

export interface MessageResult {
  messageId: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered';
  delivered: boolean;
  deliveredAt?: Date;
  error?: {
    code: string;
    message: string;
  };
}

export interface InboundMessage {
  from: string;
  to: string;
  body: string;
  messageId: string;
  receivedAt: Date;
  channel: 'sms' | 'whatsapp';
}

export interface MessagingAdapter {
  // Send message
  send(params: SendMessageParams): Promise<MessageResult>;

  // Get message status
  getStatus(messageId: string): Promise<MessageResult>;

  // Handle incoming webhook
  handleIncomingWebhook(payload: unknown): Promise<InboundMessage>;

  // Verify webhook signature
  verifySignature(url: string, params: Record<string, unknown>, signature: string): boolean;
}
```

### Payment Adapter

```typescript
// packages/integrations/src/payment/types.ts

export interface CreatePaymentLinkParams {
  amount: number;          // in cents
  currency: string;
  description: string;
  metadata: Record<string, string>;
}

export interface PaymentLink {
  linkId: string;
  url: string;
  expiresAt?: Date;
}

export interface PaymentResult {
  paymentId: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  amount: number;
  currency: string;
  metadata: Record<string, string>;
}

export interface PaymentAdapter {
  // Create payment link (no auto-charge)
  createPaymentLink(params: CreatePaymentLinkParams): Promise<PaymentLink>;

  // Handle payment webhook
  handleWebhook(payload: unknown, signature: string): Promise<PaymentResult>;

  // Verify webhook signature
  verifySignature(payload: string, signature: string): boolean;
}
```

## Calendly Adapter Implementation

```typescript
// packages/integrations/src/booking/calendly-adapter.ts

import crypto from 'crypto';
import { BookingAdapter, BookingAppointment } from './types';
import { circuitBreakers } from '../resilience/circuit-breaker';
import { executeWithRetry, RETRY_CONFIGS } from '../resilience/retry';

interface CalendlyConfig {
  apiKey: string;
  webhookSigningKey: string;
  organizationUri: string;
}

export class CalendlyAdapter implements BookingAdapter {
  private readonly baseUrl = 'https://api.calendly.com';
  private readonly headers: Record<string, string>;

  constructor(private readonly config: CalendlyConfig) {
    this.headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async fetchAppointments(params: {
    startDate: Date;
    endDate: Date;
    status?: 'booked' | 'confirmed' | 'cancelled';
  }): Promise<BookingAppointment[]> {
    return circuitBreakers.booking.execute(() =>
      executeWithRetry(
        () => this.doFetchAppointments(params),
        RETRY_CONFIGS.booking,
        'calendly_fetch'
      )
    );
  }

  private async doFetchAppointments(params: {
    startDate: Date;
    endDate: Date;
  }): Promise<BookingAppointment[]> {
    const searchParams = new URLSearchParams({
      organization: this.config.organizationUri,
      min_start_time: params.startDate.toISOString(),
      max_start_time: params.endDate.toISOString(),
      status: 'active',
    });

    const response = await fetch(
      `${this.baseUrl}/scheduled_events?${searchParams}`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Calendly API error: ${response.status}`);
    }

    const data = await response.json();
    return data.collection.map((event: unknown) => this.normalizeAppointment(event));
  }

  async updateAppointment(
    externalId: string,
    data: { status?: string; notes?: string; }
  ): Promise<BookingAppointment> {
    // Calendly has limited update capabilities
    // This is mainly for cancellation
    if (data.status === 'cancelled') {
      const response = await fetch(
        `${this.baseUrl}/scheduled_events/${externalId}/cancellation`,
        {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ reason: data.notes ?? 'Cancelled via ARO' }),
        }
      );

      if (!response.ok) {
        throw new Error(`Calendly cancellation error: ${response.status}`);
      }
    }

    // Refetch to get current state
    const response = await fetch(
      `${this.baseUrl}/scheduled_events/${externalId}`,
      { headers: this.headers }
    );

    const data = await response.json();
    return this.normalizeAppointment(data.resource);
  }

  async handleWebhook(payload: unknown, signature: string): Promise<BookingAppointment> {
    const payloadString = JSON.stringify(payload);

    if (!this.verifySignature(payloadString, signature)) {
      throw new Error('Invalid Calendly webhook signature');
    }

    const webhook = payload as CalendlyWebhook;
    return this.normalizeAppointment(webhook.payload);
  }

  verifySignature(payload: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', this.config.webhookSigningKey)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  normalizeAppointment(event: unknown): BookingAppointment {
    const calEvent = event as CalendlyEvent;

    return {
      id: crypto.randomUUID(), // Generated for internal use
      externalId: calEvent.uri.split('/').pop() ?? '',
      customer: {
        name: calEvent.invitees?.[0]?.name ?? null,
        phone: this.extractPhone(calEvent.invitees?.[0]) ?? '',
        email: calEvent.invitees?.[0]?.email ?? null,
      },
      scheduledAt: new Date(calEvent.start_time),
      duration: calEvent.duration,
      serviceType: calEvent.event_type?.name ?? 'Unknown',
      status: this.mapStatus(calEvent.status),
      notes: calEvent.invitees?.[0]?.text_answer,
    };
  }

  private extractPhone(invitee: CalendlyInvitee | undefined): string | null {
    if (!invitee) return null;

    // Check tracking fields for phone
    const phoneField = invitee.tracking_fields?.find(
      (f: { label: string; value: string }) =>
        f.label.toLowerCase().includes('phone')
    );

    return phoneField?.value ?? null;
  }

  private mapStatus(calendlyStatus: string): BookingAppointment['status'] {
    switch (calendlyStatus) {
      case 'active':
        return 'booked';
      case 'canceled':
        return 'cancelled';
      default:
        return 'booked';
    }
  }
}

// Types for Calendly API responses
interface CalendlyEvent {
  uri: string;
  status: string;
  start_time: string;
  end_time: string;
  duration: number;
  event_type?: { name: string };
  invitees?: CalendlyInvitee[];
}

interface CalendlyInvitee {
  name?: string;
  email?: string;
  text_answer?: string;
  tracking_fields?: { label: string; value: string }[];
}

interface CalendlyWebhook {
  created_at: string;
  payload: CalendlyEvent;
}
```

## Twilio Adapter Implementation

```typescript
// packages/integrations/src/messaging/twilio-adapter.ts

import twilio from 'twilio';
import { MessagingAdapter, SendMessageParams, MessageResult, InboundMessage } from './types';
import { circuitBreakers } from '../resilience/circuit-breaker';
import { executeWithRetry, RETRY_CONFIGS } from '../resilience/retry';
import { RateLimiter, API_RATE_LIMITS } from '../resilience/rate-limiter';

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

export class TwilioAdapter implements MessagingAdapter {
  private readonly client: twilio.Twilio;
  private readonly rateLimiter: RateLimiter;

  constructor(private readonly config: TwilioConfig) {
    this.client = twilio(config.accountSid, config.authToken);
    this.rateLimiter = new RateLimiter(API_RATE_LIMITS.twilio_sms);
  }

  async send(params: SendMessageParams): Promise<MessageResult> {
    // Check customer message limit (done in service layer)
    // Apply rate limiting
    await this.rateLimiter.acquire();

    // Execute through circuit breaker with retry
    return circuitBreakers.messaging.execute(() =>
      executeWithRetry(
        () => this.doSend(params),
        RETRY_CONFIGS.messaging,
        'twilio_send'
      )
    );
  }

  private async doSend(params: SendMessageParams): Promise<MessageResult> {
    const to = params.channel === 'whatsapp'
      ? `whatsapp:${params.to}`
      : params.to;

    const from = params.channel === 'whatsapp'
      ? `whatsapp:${this.config.phoneNumber}`
      : this.config.phoneNumber;

    try {
      const message = await this.client.messages.create({
        to,
        from,
        body: params.body,
      });

      return {
        messageId: message.sid,
        status: this.mapStatus(message.status),
        delivered: ['sent', 'delivered'].includes(message.status),
        error: message.errorMessage ? {
          code: message.errorCode ?? 'UNKNOWN',
          message: message.errorMessage,
        } : undefined,
      };
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string; status?: number };
      throw {
        code: err.code ?? 'TWILIO_ERROR',
        message: err.message ?? 'Unknown Twilio error',
        statusCode: err.status ?? 500,
      };
    }
  }

  async getStatus(messageId: string): Promise<MessageResult> {
    const message = await this.client.messages(messageId).fetch();

    return {
      messageId: message.sid,
      status: this.mapStatus(message.status),
      delivered: message.status === 'delivered',
      deliveredAt: message.dateSent ?? undefined,
    };
  }

  async handleIncomingWebhook(payload: unknown): Promise<InboundMessage> {
    const params = payload as Record<string, string>;

    return {
      from: params.From?.replace('whatsapp:', '') ?? '',
      to: params.To?.replace('whatsapp:', '') ?? '',
      body: params.Body ?? '',
      messageId: params.MessageSid ?? '',
      receivedAt: new Date(),
      channel: params.From?.startsWith('whatsapp:') ? 'whatsapp' : 'sms',
    };
  }

  verifySignature(
    url: string,
    params: Record<string, unknown>,
    signature: string
  ): boolean {
    return twilio.validateRequest(
      this.config.authToken,
      signature,
      url,
      params as Record<string, string>
    );
  }

  private mapStatus(twilioStatus: string): MessageResult['status'] {
    switch (twilioStatus) {
      case 'queued':
        return 'queued';
      case 'sent':
        return 'sent';
      case 'delivered':
        return 'delivered';
      case 'failed':
        return 'failed';
      case 'undelivered':
        return 'undelivered';
      default:
        return 'queued';
    }
  }
}
```

## Stripe Adapter Implementation

```typescript
// packages/integrations/src/payment/stripe-adapter.ts

import Stripe from 'stripe';
import { PaymentAdapter, CreatePaymentLinkParams, PaymentLink, PaymentResult } from './types';
import { circuitBreakers } from '../resilience/circuit-breaker';
import { executeWithRetry, RETRY_CONFIGS } from '../resilience/retry';

interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
}

export class StripeAdapter implements PaymentAdapter {
  private readonly stripe: Stripe;

  constructor(private readonly config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: '2023-10-16',
    });
  }

  async createPaymentLink(params: CreatePaymentLinkParams): Promise<PaymentLink> {
    return circuitBreakers.payment.execute(() =>
      executeWithRetry(
        () => this.doCreatePaymentLink(params),
        RETRY_CONFIGS.payment,
        'stripe_create_link'
      )
    );
  }

  private async doCreatePaymentLink(params: CreatePaymentLinkParams): Promise<PaymentLink> {
    // Create a product first (or reuse existing)
    const product = await this.stripe.products.create({
      name: params.description,
      metadata: params.metadata,
    });

    // Create a price
    const price = await this.stripe.prices.create({
      product: product.id,
      unit_amount: params.amount,
      currency: params.currency,
    });

    // Create payment link
    const paymentLink = await this.stripe.paymentLinks.create({
      line_items: [{
        price: price.id,
        quantity: 1,
      }],
      metadata: params.metadata,
    });

    return {
      linkId: paymentLink.id,
      url: paymentLink.url ?? '',
    };
  }

  async handleWebhook(payload: unknown, signature: string): Promise<PaymentResult> {
    const payloadString = JSON.stringify(payload);

    if (!this.verifySignature(payloadString, signature)) {
      throw new Error('Invalid Stripe webhook signature');
    }

    const event = payload as Stripe.Event;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      return {
        paymentId: session.id,
        status: 'completed',
        amount: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
        metadata: (session.metadata as Record<string, string>) ?? {},
      };
    }

    throw new Error(`Unhandled Stripe event type: ${event.type}`);
  }

  verifySignature(payload: string, signature: string): boolean {
    try {
      this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.webhookSecret
      );
      return true;
    } catch {
      return false;
    }
  }
}
```

## Webhook Handler

```typescript
// apps/api/src/routes/webhooks.ts

import { Router } from 'express';
import { CalendlyAdapter } from '@aro/integrations/booking/calendly-adapter';
import { TwilioAdapter } from '@aro/integrations/messaging/twilio-adapter';
import { StripeAdapter } from '@aro/integrations/payment/stripe-adapter';
import { IdempotencyService } from '@aro/database/idempotency';

const router = Router();

// Initialize adapters
const calendlyAdapter = new CalendlyAdapter(config.calendly);
const twilioAdapter = new TwilioAdapter(config.twilio);
const stripeAdapter = new StripeAdapter(config.stripe);
const idempotency = new IdempotencyService(db);

// Calendly webhook
router.post('/calendly', async (req, res) => {
  const signature = req.headers['calendly-webhook-signature'] as string;
  const payload = req.body;

  try {
    // Verify signature
    if (!calendlyAdapter.verifySignature(JSON.stringify(payload), signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Check idempotency
    const eventId = payload.id ?? crypto.randomUUID();
    const key = `calendly:${eventId}`;

    if (!await idempotency.checkAndLock(key)) {
      return res.json({ status: 'already_processed' });
    }

    // Process webhook
    const appointment = await calendlyAdapter.handleWebhook(payload, signature);
    await appointmentService.processNewAppointment(appointment);

    res.json({ status: 'success', appointmentId: appointment.id });
  } catch (error) {
    logger.error('Calendly webhook error', { error, payload });
    res.status(500).json({ error: 'Processing failed' });
  }
});

// Twilio inbound SMS
router.post('/twilio/inbound', async (req, res) => {
  const signature = req.headers['x-twilio-signature'] as string;
  const url = `${config.baseUrl}/webhooks/twilio/inbound`;

  try {
    // Verify signature
    if (!twilioAdapter.verifySignature(url, req.body, signature)) {
      return res.status(401).send('Invalid signature');
    }

    // Process inbound message
    const message = await twilioAdapter.handleIncomingWebhook(req.body);
    await messagingService.processInboundMessage(message);

    // Respond with TwiML (optional)
    res.type('text/xml').send('<Response></Response>');
  } catch (error) {
    logger.error('Twilio webhook error', { error });
    res.status(500).send('Error');
  }
});

// Stripe webhook
router.post('/stripe', async (req, res) => {
  const signature = req.headers['stripe-signature'] as string;
  const payload = JSON.stringify(req.body);

  try {
    // Verify signature
    if (!stripeAdapter.verifySignature(payload, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Check idempotency
    const eventId = req.body.id;
    const key = `stripe:${eventId}`;

    if (!await idempotency.checkAndLock(key)) {
      return res.json({ status: 'already_processed' });
    }

    // Process webhook
    const payment = await stripeAdapter.handleWebhook(req.body, signature);
    await paymentService.processPayment(payment);

    res.json({ status: 'success' });
  } catch (error) {
    logger.error('Stripe webhook error', { error });
    res.status(500).json({ error: 'Processing failed' });
  }
});

export default router;
```

## Integration Testing

```typescript
// tests/integration/calendly-adapter.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CalendlyAdapter } from '@aro/integrations/booking/calendly-adapter';

describe('CalendlyAdapter', () => {
  let adapter: CalendlyAdapter;

  beforeAll(() => {
    adapter = new CalendlyAdapter({
      apiKey: process.env.CALENDLY_API_KEY!,
      webhookSigningKey: process.env.CALENDLY_WEBHOOK_SECRET!,
      organizationUri: process.env.CALENDLY_ORG_URI!,
    });
  });

  describe('verifySignature', () => {
    it('validates correct signatures', () => {
      const payload = JSON.stringify({ test: true });
      const signature = crypto
        .createHmac('sha256', process.env.CALENDLY_WEBHOOK_SECRET!)
        .update(payload)
        .digest('hex');

      expect(adapter.verifySignature(payload, signature)).toBe(true);
    });

    it('rejects invalid signatures', () => {
      const payload = JSON.stringify({ test: true });
      expect(adapter.verifySignature(payload, 'invalid')).toBe(false);
    });

    it('rejects tampered payloads', () => {
      const payload = JSON.stringify({ test: true });
      const signature = crypto
        .createHmac('sha256', process.env.CALENDLY_WEBHOOK_SECRET!)
        .update(payload)
        .digest('hex');

      expect(adapter.verifySignature(payload + 'tampered', signature)).toBe(false);
    });
  });

  describe('normalizeAppointment', () => {
    it('maps Calendly event to internal format', () => {
      const calendlyEvent = {
        uri: 'https://api.calendly.com/scheduled_events/ABC123',
        status: 'active',
        start_time: '2026-03-15T14:00:00Z',
        end_time: '2026-03-15T15:00:00Z',
        duration: 60,
        event_type: { name: 'Dental Cleaning' },
        invitees: [{
          name: 'John Doe',
          email: 'john@example.com',
        }],
      };

      const result = adapter.normalizeAppointment(calendlyEvent);

      expect(result.externalId).toBe('ABC123');
      expect(result.customer.name).toBe('John Doe');
      expect(result.serviceType).toBe('Dental Cleaning');
      expect(result.duration).toBe(60);
      expect(result.status).toBe('booked');
    });
  });
});
```

## Adapter Checklist

Before deploying any adapter:

- [ ] Interface contract implemented
- [ ] Webhook signature verification
- [ ] Circuit breaker configured
- [ ] Rate limiting applied
- [ ] Retry logic with backoff
- [ ] Idempotency handling
- [ ] Error mapping to standard codes
- [ ] Integration tests pass
- [ ] Mock mode for testing
