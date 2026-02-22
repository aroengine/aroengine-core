import { z } from 'zod';

const installerInputSchema = z.object({
  businessName: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  databaseUrl: z.string().min(1),
  timezone: z.string().min(1),
});

export type InstallerInput = z.infer<typeof installerInputSchema>;

export function generateEnvFile(input: InstallerInput): string {
  const parsed = installerInputSchema.parse(input);

  return [
    `BUSINESS_NAME=${parsed.businessName}`,
    `HOST=${parsed.host}`,
    `PORT=${parsed.port}`,
    `DATABASE_URL=${parsed.databaseUrl}`,
    `TIMEZONE=${parsed.timezone}`,
  ].join('\n');
}

export function validateInstallerInput(input: InstallerInput): InstallerInput {
  return installerInputSchema.parse(input);
}