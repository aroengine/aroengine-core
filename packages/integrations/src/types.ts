export interface NormalizedEvent {
  type: string;
  entityId: string;
  occurredAt: string;
  source: 'calendly' | 'twilio' | 'stripe';
  payload: Record<string, unknown>;
}

export interface BookingAdapter {
  verifySignature(payload: string, signature: string): boolean;
  getIdempotencyKey(payload: Record<string, unknown>): string;
  handleWebhook(payload: Record<string, unknown>): Promise<NormalizedEvent>;
}

export interface MessagingAdapter {
  verifySignature(payload: string, signature: string): boolean;
  getIdempotencyKey(payload: Record<string, unknown>): string;
  handleIncomingWebhook(payload: Record<string, unknown>): Promise<NormalizedEvent>;
  handleDeliveryWebhook(payload: Record<string, unknown>): Promise<NormalizedEvent>;
}

export interface PaymentAdapter {
  verifySignature(payload: string, signature: string): boolean;
  getIdempotencyKey(payload: Record<string, unknown>): string;
  handleWebhook(payload: Record<string, unknown>): Promise<NormalizedEvent>;
}