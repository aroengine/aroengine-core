import { ZodError } from 'zod';

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  APPOINTMENT_NOT_FOUND: 'APPOINTMENT_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryAfter?: number;
  };
}

export class AroError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'AroError';
  }
}

export function toErrorResponse(error: unknown): {
  statusCode: number;
  body: ErrorEnvelope;
} {
  if (error instanceof AroError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
        },
      },
    };
  }

  if (error instanceof ZodError) {
    const details: Record<string, unknown> = {};
    for (const issue of error.issues) {
      const issueKey = issue.path.length > 0 ? issue.path.join('.') : 'request';
      details[issueKey] = issue.message;
    }

    return {
      statusCode: 400,
      body: {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid request parameters',
          details,
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
      },
    },
  };
}