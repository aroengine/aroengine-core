type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type LogFields = Record<string, JsonValue>;
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface Logger {
  child(context: LogFields): Logger;
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  fatal(message: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  service: string;
  level: LogLevel;
}

const levelPriority: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const sensitiveKeyPattern = /authorization|cookie|token|secret|password|api[-_]?key|auth/i;

function sanitizeValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (typeof value === 'object') {
    const sanitizedObject: { [key: string]: JsonValue } = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      sanitizedObject[key] = sensitiveKeyPattern.test(key)
        ? '[REDACTED]'
        : sanitizeValue(nestedValue);
    }

    return sanitizedObject;
  }

  return String(value);
}

function sanitizeFields(fields: LogFields): LogFields {
  const sanitized: LogFields = {};

  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = sensitiveKeyPattern.test(key) ? '[REDACTED]' : sanitizeValue(value);
  }

  return sanitized;
}

class JsonLogger implements Logger {
  constructor(
    private readonly options: LoggerOptions,
    private readonly context: LogFields = {},
  ) {}

  child(context: LogFields): Logger {
    return new JsonLogger(this.options, { ...this.context, ...sanitizeFields(context) });
  }

  trace(message: string, fields?: LogFields): void {
    this.log('trace', message, fields);
  }

  debug(message: string, fields?: LogFields): void {
    this.log('debug', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.log('info', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.log('warn', message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.log('error', message, fields);
  }

  fatal(message: string, fields?: LogFields): void {
    this.log('fatal', message, fields);
  }

  private log(level: LogLevel, message: string, fields?: LogFields): void {
    if (levelPriority[level] < levelPriority[this.options.level]) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service: this.options.service,
      message,
      ...sanitizeFields(this.context),
      ...(fields === undefined ? {} : sanitizeFields(fields)),
    };

    const line = JSON.stringify(payload);
    if (levelPriority[level] >= levelPriority.error) {
      console.error(line);
      return;
    }

    console.log(line);
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new JsonLogger(options);
}