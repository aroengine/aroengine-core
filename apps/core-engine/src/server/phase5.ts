import { createHmac, randomUUID } from 'node:crypto';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private openedAtMs = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  getState(): CircuitState {
    if (this.state === 'open' && Date.now() - this.openedAtMs >= this.options.timeoutMs) {
      this.state = 'half-open';
      this.successCount = 0;
    }
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === 'open') {
      const error = new Error('Circuit breaker open') as Error & { code: string };
      error.code = 'CIRCUIT_BREAKER_OPEN';
      throw error;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount += 1;
      if (this.successCount >= this.options.successThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
      }
      return;
    }

    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount += 1;
    this.successCount = 0;

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAtMs = Date.now();
    }
  }
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefillMs: number }>();

  constructor(
    private readonly maxTokens: number,
    private readonly refillWindowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const existing = this.buckets.get(key) ?? {
      tokens: this.maxTokens,
      lastRefillMs: now,
    };

    const elapsed = now - existing.lastRefillMs;
    const refillCount = Math.floor(elapsed / this.refillWindowMs);
    const refilledTokens =
      refillCount > 0
        ? Math.min(this.maxTokens, existing.tokens + refillCount * this.maxTokens)
        : existing.tokens;

    const updated = {
      tokens: refilledTokens,
      lastRefillMs: refillCount > 0 ? now : existing.lastRefillMs,
    };

    if (updated.tokens <= 0) {
      this.buckets.set(key, updated);
      return false;
    }

    updated.tokens -= 1;
    this.buckets.set(key, updated);
    return true;
  }
}

export class RetryWithJitter {
  constructor(
    private readonly random: () => number = () => Math.random(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async run<T>(
    operation: () => Promise<T>,
    maxAttempts = 3,
    initialDelayMs = 250,
    maxDelayMs = 10_000,
  ): Promise<T> {
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await operation();
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw error;
        }

        const baseDelay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
        const jitter = Math.floor(baseDelay * 0.2 * this.random());
        await this.sleep(baseDelay + jitter);
      }
    }

    throw new Error('Unreachable retry state');
  }
}

export class FallbackQueue {
  private readonly items: Array<{ id: string; payload: Record<string, unknown> }> = [];

  enqueue(payload: Record<string, unknown>): string {
    const id = randomUUID();
    this.items.push({ id, payload });
    return id;
  }

  drain(): Array<{ id: string; payload: Record<string, unknown> }> {
    const drained = [...this.items];
    this.items.length = 0;
    return drained;
  }

  size(): number {
    return this.items.length;
  }
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
  payload: Record<string, unknown>;
  hash: string;
  previousHash: string;
}

export class AuditLogService {
  private readonly entries: AuditLogEntry[] = [];

  append(action: string, actor: string, payload: Record<string, unknown>): AuditLogEntry {
    const previousHash = this.entries.length === 0 ? 'GENESIS' : this.entries[this.entries.length - 1]!.hash;
    const timestamp = new Date().toISOString();
    const hash = createHmac('sha256', 'audit-chain')
      .update(`${action}|${actor}|${timestamp}|${JSON.stringify(payload)}|${previousHash}`)
      .digest('hex');

    const entry: AuditLogEntry = {
      id: randomUUID(),
      action,
      actor,
      timestamp,
      payload,
      hash,
      previousHash,
    };

    this.entries.push(entry);
    return entry;
  }

  list(): AuditLogEntry[] {
    return [...this.entries];
  }

  verifyIntegrity(): boolean {
    let previousHash = 'GENESIS';
    for (const entry of this.entries) {
      const expectedHash = createHmac('sha256', 'audit-chain')
        .update(`${entry.action}|${entry.actor}|${entry.timestamp}|${JSON.stringify(entry.payload)}|${previousHash}`)
        .digest('hex');

      if (entry.hash !== expectedHash || entry.previousHash !== previousHash) {
        return false;
      }

      previousHash = entry.hash;
    }
    return true;
  }
}

export class AdminAuthService {
  constructor(
    private readonly secret: string,
    private readonly adminUsername: string,
    private readonly adminPassword: string,
  ) {}

  issueToken(username: string, password: string): string | null {
    if (username !== this.adminUsername || password !== this.adminPassword) {
      return null;
    }

    const issuedAt = Date.now();
    const body = `${username}:${issuedAt}`;
    const signature = createHmac('sha256', this.secret).update(body).digest('hex');
    return Buffer.from(`${body}:${signature}`).toString('base64');
  }

  verifyToken(token: string): boolean {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [username, issuedAt, signature] = decoded.split(':');
    if (username === undefined || issuedAt === undefined || signature === undefined) {
      return false;
    }

    const body = `${username}:${issuedAt}`;
    const expected = createHmac('sha256', this.secret).update(body).digest('hex');
    return signature === expected && username === this.adminUsername;
  }
}

interface ConsentRecord {
  customerId: string;
  consentGiven: boolean;
  consentDate?: string;
  optOutDate?: string;
}

export class PrivacyService {
  private readonly consents = new Map<string, ConsentRecord>();
  private readonly customerData = new Map<string, Record<string, unknown>>();

  setCustomerData(customerId: string, data: Record<string, unknown>): void {
    this.customerData.set(customerId, data);
  }

  grantConsent(customerId: string): ConsentRecord {
    const record: ConsentRecord = {
      customerId,
      consentGiven: true,
      consentDate: new Date().toISOString(),
    };
    this.consents.set(customerId, record);
    return record;
  }

  optOut(customerId: string): ConsentRecord {
    const current = this.consents.get(customerId) ?? { customerId, consentGiven: false };
    const updated: ConsentRecord = {
      ...current,
      consentGiven: false,
      optOutDate: new Date().toISOString(),
    };
    this.consents.set(customerId, updated);
    return updated;
  }

  exportCustomer(customerId: string): Record<string, unknown> {
    return {
      customer: this.customerData.get(customerId) ?? null,
      consent: this.consents.get(customerId) ?? null,
    };
  }

  deleteCustomer(customerId: string): void {
    this.customerData.delete(customerId);
    this.consents.delete(customerId);
  }
}