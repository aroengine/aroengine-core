import { randomUUID } from 'node:crypto';

export interface CoreEventEnvelope {
  eventId: string;
  eventType: string;
  tenantId: string;
  correlationId: string;
  emittedAt: string;
  replayCursor: string;
  payload: Record<string, unknown>;
}

interface EventSubscription {
  id: string;
  tenantId: string;
  callbackUrl?: string;
  cursor: string;
  createdAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class InMemoryEventStream {
  private readonly events: CoreEventEnvelope[] = [];
  private readonly subscriptions = new Map<string, EventSubscription>();

  append(input: Omit<CoreEventEnvelope, 'eventId' | 'emittedAt' | 'replayCursor'>): CoreEventEnvelope {
    const event: CoreEventEnvelope = {
      eventId: randomUUID(),
      emittedAt: nowIso(),
      replayCursor: String(this.events.length + 1),
      ...input,
    };

    this.events.push(event);
    return event;
  }

  list(options: { tenantId?: string; after?: string; limit?: number }): CoreEventEnvelope[] {
    const afterValue = options.after === undefined ? 0 : Number(options.after);
    const limit = options.limit ?? 100;

    const filtered = this.events.filter((event) => {
      const cursor = Number(event.replayCursor);
      const tenantMatches = options.tenantId === undefined || event.tenantId === options.tenantId;
      return tenantMatches && cursor > (Number.isNaN(afterValue) ? 0 : afterValue);
    });

    return filtered.slice(0, limit);
  }

  createSubscription(tenantId: string, callbackUrl?: string): EventSubscription {
    const id = randomUUID();
    const created: EventSubscription = {
      id,
      tenantId,
      cursor: '0',
      createdAt: nowIso(),
      ...(callbackUrl === undefined ? {} : { callbackUrl }),
    };

    this.subscriptions.set(id, created);
    return created;
  }

  replaySubscription(subscriptionId: string, after?: string): CoreEventEnvelope[] {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription === undefined) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const events = this.list({
      tenantId: subscription.tenantId,
      after: after ?? subscription.cursor,
      limit: 100,
    });

    const last = events[events.length - 1];
    if (last !== undefined) {
      subscription.cursor = last.replayCursor;
      this.subscriptions.set(subscriptionId, subscription);
    }

    return events;
  }
}
