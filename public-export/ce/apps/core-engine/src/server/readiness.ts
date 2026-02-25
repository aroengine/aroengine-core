import { CoreEngineConfig } from './config.js';
import { MigrationSource } from './migrations/index.js';

export interface ReadinessCheck {
  name: string;
  run(): Promise<'up' | 'down'>;
}

function isSupportedDatabaseUrl(databaseUrl: string): boolean {
  return databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('sqlite:');
}

export function createDefaultReadinessChecks(
  config: CoreEngineConfig,
  migrationSource: MigrationSource,
): ReadinessCheck[] {
  return [
    {
      name: 'database',
      async run() {
        return isSupportedDatabaseUrl(config.DATABASE_URL) ? 'up' : 'down';
      },
    },
    {
      name: 'migrations',
      async run() {
        const migrations = await migrationSource.load();
        return migrations.length > 0 ? 'up' : 'down';
      },
    },
    {
      name: 'openclaw',
      async run() {
        return 'up';
      },
    },
  ];
}