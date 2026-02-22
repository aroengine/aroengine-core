---
name: aro-resilience-patterns
description: Implement production-grade resilience patterns for ARO including circuit
  breakers, rate limiting, retry with backoff, and dead letter queues. Based on docs/specs/04_api_integrations.md
  Section 7. Use when building integrations or handling external API calls.
---

# ARO Resilience Patterns

Production-grade resilience implementation for handling external API failures and ensuring system stability.

## Why Resilience Matters

External APIs (Twilio, Stripe, Calendly) can fail. Without resilience patterns:
- We hammer failing services (waste resources)
- Errors cascade through the system
- Customer messages are lost
- Debugging becomes impossible

## Core Patterns

### 1. Circuit Breaker

Fail fast when external services are down.

```typescript
// Circuit breaker states
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;      // Open after N failures
  successThreshold: number;      // Close after N successes
  timeout: number;               // Half-open timeout (ms)
  monitoringPeriod: number;      // Rolling window (ms)
}

// Per-provider configuration
const CIRCUIT_BREAKERS: Record<string, CircuitBreakerConfig> = {
  // Critical: Messaging must work for reminders
  messaging: {
    failureThreshold: 5,         // Open after 5 failures
    successThreshold: 2,         // Close after 2 successes
    timeout: 60000,              // Try again after 1 minute
    monitoringPeriod: 300000,    // 5 minute rolling window
  },

  // Important but not critical: Booking sync can wait
  booking: {
    failureThreshold: 10,
    successThreshold: 3,
    timeout: 120000,             // Try again after 2 minutes
    monitoringPeriod: 600000,    // 10 minute rolling window
  },

  // Payment links are synchronous user actions
  payment: {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000,              // Try again after 30 seconds
    monitoringPeriod: 180000,    // 3 minute rolling window
  },
};

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: Date | null = null;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // If circuit is OPEN, fail fast
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - (this.lastFailureTime?.getTime() ?? 0);

      if (timeSinceFailure < this.config.timeout) {
        throw new AroError(
          ERROR_CODES.CIRCUIT_BREAKER_OPEN,
          `Circuit breaker is OPEN for ${this.name} - service unavailable`,
          503,
          { retryAfter: Math.ceil((this.config.timeout - timeSinceFailure) / 1000) }
        );
      }

      // Timeout elapsed, try HALF_OPEN
      this.state = 'HALF_OPEN';
      this.successes = 0;
      logger.info(`Circuit breaker HALF_OPEN for ${this.name}`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;

    if (this.state === 'HALF_OPEN') {
      this.successes++;

      if (this.successes >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.successes = 0;
        logger.info(`Circuit breaker CLOSED for ${this.name}`);
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();

    if (this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      logger.error(`Circuit breaker OPENED for ${this.name}`, {
        failures: this.failures,
        threshold: this.config.failureThreshold,
      });

      // Alert admin
      this.notifyAdmin();
    }
  }

  private async notifyAdmin(): Promise<void> {
    await adminNotifier.send({
      type: 'circuit_breaker_open',
      service: this.name,
      state: this.state,
      failures: this.failures,
    });
  }

  getState(): CircuitState {
    return this.state;
  }

  // Manual reset for admin intervention
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    logger.info(`Circuit breaker manually reset for ${this.name}`);
  }
}

// Singleton instances
const circuitBreakers = {
  messaging: new CircuitBreaker('messaging', CIRCUIT_BREAKERS.messaging),
  booking: new CircuitBreaker('booking', CIRCUIT_BREAKERS.booking),
  payment: new CircuitBreaker('payment', CIRCUIT_BREAKERS.payment),
};

export { circuitBreakers };
```

### 2. Rate Limiting

Prevent abuse and respect API limits.

```typescript
interface RateLimitConfig {
  requests: number;     // Number of requests
  period: number;       // Period in milliseconds
  burst: number;        // Max burst above limit
}

// Outbound rate limits (respect third-party limits)
const API_RATE_LIMITS: Record<string, RateLimitConfig> = {
  twilio_sms: {
    requests: 60,       // 60 messages
    period: 60000,      // per minute
    burst: 10,          // allow 10 burst
  },

  calendly: {
    requests: 100,
    period: 3600000,    // per hour
    burst: 20,
  },

  stripe: {
    requests: 100,
    period: 1000,       // per second
    burst: 5,
  },
};

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: Date;

  constructor(private readonly config: RateLimitConfig) {
    this.tokens = config.requests;
    this.lastRefill = new Date();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens <= 0) {
      const waitTime = this.getWaitTime();
      logger.warn('Rate limit reached, waiting', { waitMs: waitTime });
      await this.sleep(waitTime);
      this.refill();
    }

    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill.getTime();
    const periods = Math.floor(timePassed / this.config.period);

    if (periods > 0) {
      this.tokens = Math.min(
        this.config.requests + this.config.burst,
        this.tokens + (periods * this.config.requests)
      );
      this.lastRefill = new Date();
    }
  }

  private getWaitTime(): number {
    const timeSinceRefill = Date.now() - this.lastRefill.getTime();
    return this.config.period - timeSinceRefill;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Customer message rate limit (business logic)
const CUSTOMER_MESSAGE_LIMIT = {
  perCustomer: 3,       // Max 3 messages
  period: 86400000,     // per day (24h)
};

async function checkCustomerMessageLimit(customerId: string): Promise<boolean> {
  const sentToday = await db.reminderLogs.count({
    where: {
      customerId,
      sentAt: { gte: new Date(Date.now() - CUSTOMER_MESSAGE_LIMIT.period) },
    },
  });

  if (sentToday >= CUSTOMER_MESSAGE_LIMIT.perCustomer) {
    logger.warn('Customer message rate limit exceeded', {
      customerId,
      sentToday,
      limit: CUSTOMER_MESSAGE_LIMIT.perCustomer,
    });

    // Alert admin if configured
    await notifyAdmin({
      type: 'rate_limit_hit',
      customerId,
      messagesAttempted: sentToday + 1,
      limit: CUSTOMER_MESSAGE_LIMIT.perCustomer,
    });

    return false;
  }

  return true;
}
```

### 3. Retry with Exponential Backoff

Handle transient failures gracefully.

```typescript
interface RetryConfig {
  maxAttempts: number;
  backoffStrategy: 'fixed' | 'exponential' | 'linear';
  initialDelay: number;     // milliseconds
  maxDelay: number;         // milliseconds
  retryableErrors: string[];
}

const RETRY_CONFIGS: Record<string, RetryConfig> = {
  // Messaging: Aggressive retries (critical for reminders)
  messaging: {
    maxAttempts: 5,
    backoffStrategy: 'exponential',
    initialDelay: 500,
    maxDelay: 30000,
    retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', '503', '429'],
  },

  // Booking: Moderate retries (important but not time-critical)
  booking: {
    maxAttempts: 3,
    backoffStrategy: 'exponential',
    initialDelay: 1000,
    maxDelay: 60000,
    retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', '503', '502'],
  },

  // Payment: Limited retries (user is waiting)
  payment: {
    maxAttempts: 2,
    backoffStrategy: 'linear',
    initialDelay: 2000,
    maxDelay: 5000,
    retryableErrors: ['NETWORK_ERROR', 'TIMEOUT'],
  },
};

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  context: string
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error as Error;

      // Don't retry if error is not retryable
      if (!isRetryable(error, config.retryableErrors)) {
        logger.error('Non-retryable error', { context, error });
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === config.maxAttempts) {
        logger.error('Max retries exceeded', { context, attempts: attempt });
        throw error;
      }

      // Calculate backoff delay with jitter
      const delay = calculateBackoff(attempt, config);

      logger.warn('Retrying operation', {
        context,
        attempt,
        maxAttempts: config.maxAttempts,
        delay,
        error: lastError.message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

function calculateBackoff(attempt: number, config: RetryConfig): number {
  let delay: number;

  switch (config.backoffStrategy) {
    case 'fixed':
      delay = config.initialDelay;
      break;
    case 'linear':
      delay = config.initialDelay * attempt;
      break;
    case 'exponential':
      delay = config.initialDelay * Math.pow(2, attempt - 1);
      break;
  }

  // Add jitter to prevent thundering herd (10% randomization)
  const jitter = Math.random() * 0.1 * delay;
  delay = delay + jitter;

  return Math.min(delay, config.maxDelay);
}

function isRetryable(error: unknown, retryableErrors: string[]): boolean {
  const err = error as { code?: string; statusCode?: number; message?: string };
  return retryableErrors.some(code =>
    err.code === code ||
    err.statusCode?.toString() === code ||
    err.message?.includes(code)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 4. Dead Letter Queue

Capture failed workflows for recovery.

```typescript
interface DeadLetter {
  id: string;
  workflowId: string;
  skillName: string;
  context: Record<string, unknown>;
  error: {
    message: string;
    stack: string;
    code: string;
  };
  attempts: number;
  createdAt: Date;
  lastAttemptAt: Date;
}

class DeadLetterQueue {
  constructor(private readonly db: Database) {}

  async add(item: Omit<DeadLetter, 'id' | 'createdAt'>): Promise<string> {
    const id = crypto.randomUUID();
    const dlqItem: DeadLetter = {
      ...item,
      id,
      createdAt: new Date(),
    };

    await this.db.deadLetters.create(dlqItem);

    // Notify admin
    await this.notifyAdmin({
      type: 'dead_letter_added',
      workflowId: item.workflowId,
      skillName: item.skillName,
      error: item.error.message,
    });

    logger.error('Added to dead letter queue', {
      id,
      workflowId: item.workflowId,
      skillName: item.skillName,
    });

    return id;
  }

  async retry(id: string): Promise<void> {
    const item = await this.db.deadLetters.findById(id);
    if (!item) {
      throw new Error(`Dead letter not found: ${id}`);
    }

    // Re-queue for processing
    await this.workflowEngine.execute(item.workflowId, item.context);

    // Remove from DLQ on successful retry
    await this.db.deadLetters.delete(id);

    logger.info('Dead letter retry successful', { id, workflowId: item.workflowId });
  }

  async archive(id: string): Promise<void> {
    await this.db.deadLetters.update(id, { archived: true });
    logger.info('Dead letter archived', { id });
  }

  async list(filter?: { skillName?: string; since?: Date }): Promise<DeadLetter[]> {
    return this.db.deadLetters.findMany({
      where: {
        archived: false,
        ...filter,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

### 5. Fallback Strategy

Graceful degradation when services fail.

```typescript
async function sendReminderWithFallback(
  customerId: string,
  appointmentId: string
): Promise<void> {
  const customer = await db.customers.findById(customerId);
  const appointment = await db.appointments.findById(appointmentId);

  try {
    // Primary: Send via preferred channel
    await sendViaPreferredChannel(customer, appointment);

  } catch (error: unknown) {
    const err = error as { code?: string; retryAfter?: number };

    if (err.code === ERROR_CODES.CIRCUIT_BREAKER_OPEN) {
      // Fallback: Queue for later retry
      await messageQueue.add('reminders', {
        customerId,
        appointmentId,
        scheduledFor: new Date(Date.now() + 300000), // Retry in 5 min
      });

      await notifyAdmin({
        type: 'reminder_queued',
        reason: 'circuit_breaker_open',
        appointmentId,
      });

    } else if (err.code === ERROR_CODES.RATE_LIMIT_EXCEEDED) {
      // Fallback: Schedule for later
      const retryAfter = err.retryAfter ?? 60;
      await messageQueue.add('reminders', {
        customerId,
        appointmentId,
        scheduledFor: new Date(Date.now() + retryAfter * 1000),
      });

    } else {
      // Unrecoverable error - escalate
      await notifyAdmin({
        type: 'reminder_failed',
        error: err.message ?? 'Unknown error',
        appointmentId,
        priority: 'high',
      });

      throw error;
    }
  }
}
```

## Integration with Adapters

### Twilio Adapter with Resilience

```typescript
class TwilioAdapter implements MessagingAdapter {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly rateLimiter: TokenBucketRateLimiter;

  constructor(config: TwilioConfig) {
    this.circuitBreaker = circuitBreakers.messaging;
    this.rateLimiter = new TokenBucketRateLimiter(API_RATE_LIMITS.twilio_sms);
  }

  async send(params: MessageParams): Promise<SendResult> {
    // Apply rate limiting first
    await this.rateLimiter.acquire();

    // Execute through circuit breaker with retry
    return this.circuitBreaker.execute(() =>
      executeWithRetry(
        () => this.doSend(params),
        RETRY_CONFIGS.messaging,
        'twilio_send'
      )
    );
  }

  private async doSend(params: MessageParams): Promise<SendResult> {
    // Actual Twilio API call
    const response = await this.client.messages.create({
      to: params.to,
      from: this.config.phoneNumber,
      body: params.body,
    });

    return {
      messageId: response.sid,
      status: response.status,
      delivered: ['sent', 'delivered'].includes(response.status),
    };
  }
}
```

## Monitoring & Observability

```typescript
// Export metrics for monitoring
interface ResilienceMetrics {
  circuitBreakerState: Record<string, CircuitState>;
  rateLimiterTokens: Record<string, number>;
  deadLetterCount: number;
  retryAttempts: Record<string, number>;
}

export function getResilienceMetrics(): ResilienceMetrics {
  return {
    circuitBreakerState: {
      messaging: circuitBreakers.messaging.getState(),
      booking: circuitBreakers.booking.getState(),
      payment: circuitBreakers.payment.getState(),
    },
    rateLimiterTokens: {
      // Current token counts
    },
    deadLetterCount: 0, // From DLQ query
    retryAttempts: {
      // Retry statistics
    },
  };
}

// Health check integration
app.get('/health', (req, res) => {
  const metrics = getResilienceMetrics();

  const unhealthyServices = Object.entries(metrics.circuitBreakerState)
    .filter(([_, state]) => state === 'OPEN')
    .map(([name]) => name);

  res.json({
    status: unhealthyServices.length === 0 ? 'healthy' : 'degraded',
    services: {
      messaging: metrics.circuitBreakerState.messaging,
      booking: metrics.circuitBreakerState.booking,
      payment: metrics.circuitBreakerState.payment,
    },
    deadLetterCount: metrics.deadLetterCount,
  });
});
```

## Resilience Checklist

Before deploying any integration:

- [ ] Circuit breaker configured per provider
- [ ] Rate limiting applied to outbound calls
- [ ] Customer message limits enforced
- [ ] Retry with exponential backoff implemented
- [ ] Dead letter queue handling in place
- [ ] Fallback strategies defined
- [ ] Metrics exported for monitoring
- [ ] Health check includes resilience status
