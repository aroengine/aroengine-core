export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryableErrorCodes: string[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  retryableErrorCodes: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', '503', '429'],
};

export interface RetryExecutorDependencies {
  sleep(ms: number): Promise<void>;
  random(): number;
}

const defaultDependencies: RetryExecutorDependencies = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === 'string') {
    return maybeCode;
  }

  return null;
}

export class RetryExecutor {
  constructor(private readonly dependencies: RetryExecutorDependencies = defaultDependencies) {}

  getBackoffDelayMs(attempt: number, policy: RetryPolicy): number {
    const exponential = policy.initialDelayMs * 2 ** (attempt - 1);
    const capped = Math.min(exponential, policy.maxDelayMs);
    const jitter = Math.floor(capped * 0.1 * this.dependencies.random());
    return Math.min(capped + jitter, policy.maxDelayMs);
  }

  async execute<T>(
    operation: () => Promise<T>,
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const code = getErrorCode(error);
        const retryable = code !== null && policy.retryableErrorCodes.includes(code);
        if (!retryable || attempt === policy.maxAttempts) {
          throw error;
        }

        const delay = this.getBackoffDelayMs(attempt, policy);
        await this.dependencies.sleep(delay);
      }
    }

    throw lastError;
  }
}