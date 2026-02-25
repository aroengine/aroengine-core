import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AroError, ERROR_CODES, toErrorResponse } from '../../server/errors.js';

describe('toErrorResponse', () => {
  it('maps AroError with metadata', () => {
    const error = new AroError(
      ERROR_CODES.RATE_LIMIT_EXCEEDED,
      429,
      'Too many requests',
      { scope: 'commands' },
      60,
    );

    const response = toErrorResponse(error);

    expect(response.statusCode).toBe(429);
    expect(response.body.error.code).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
    expect(response.body.error.retryAfter).toBe(60);
  });

  it('maps ZodError to validation envelope', () => {
    const schema = z.object({ foo: z.string().min(2) });

    const result = schema.safeParse({ foo: '' });
    if (result.success) {
      throw new Error('expected schema to fail');
    }

    const response = toErrorResponse(result.error);
    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(response.body.error.details).toBeDefined();
  });
});