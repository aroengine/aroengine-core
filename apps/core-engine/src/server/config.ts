import { z } from 'zod';

const coreEngineEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  HOST: z.string().min(1),
  PORT: z.string().regex(/^\d+$/).transform(Number),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATION_LOCK_TIMEOUT: z.string().regex(/^\d+$/).transform(Number),
  OPENCLAW_EXECUTOR_URL: z.string().url(),
  OPENCLAW_SHARED_TOKEN: z.string().min(16),
  CORE_SERVICE_SHARED_TOKEN: z.string().min(16),
  OPENCLAW_PERMISSION_MANIFEST_VERSION: z.string().min(1),
  CORE_COMMAND_QUEUE_FILE: z.string().min(1),
  CORE_DISPATCH_WORKER_INTERVAL_MS: z.string().regex(/^\d+$/).transform(Number),
  CORE_DISPATCH_WORKER_MAX_ATTEMPTS: z.string().regex(/^\d+$/).transform(Number),
});

export type CoreEngineConfig = z.infer<typeof coreEngineEnvSchema>;

export function loadCoreEngineConfig(
  source: NodeJS.ProcessEnv = process.env,
): CoreEngineConfig {
  try {
    return coreEngineEnvSchema.parse(source);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issueText = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(`Configuration errors: ${issueText}`);
    }

    throw error;
  }
}