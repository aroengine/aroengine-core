import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  PORT: z.string().regex(/^\d+$/).transform(Number),
  HOST: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(64),
  ENCRYPTION_SALT: z.string().min(16),
  CALENDLY_API_KEY: z.string().startsWith('Bearer '),
  CALENDLY_WEBHOOK_SECRET: z.string().min(32),
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC'),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+\d{10,15}$/),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadEnvConfig(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  return envSchema.parse(source);
}
