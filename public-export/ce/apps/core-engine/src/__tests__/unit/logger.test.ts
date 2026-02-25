import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../server/logger.js';

describe('logger', () => {
  it('redacts sensitive fields and emits info logs', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = createLogger({ service: 'core-engine', level: 'info' });

    logger.info('test', {
      apiKey: 'secret',
      nested: { authToken: 'abc' },
      safe: 'value',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0]?.[0]);
    expect(line).toContain('[REDACTED]');
    expect(line).toContain('"safe":"value"');

    logSpy.mockRestore();
  });

  it('emits errors to stderr and supports child context', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createLogger({ service: 'core-engine', level: 'trace' }).child({
      correlationId: 'corr-1',
    });

    logger.error('boom', { reason: 'test' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).toContain('corr-1');

    errorSpy.mockRestore();
  });
});