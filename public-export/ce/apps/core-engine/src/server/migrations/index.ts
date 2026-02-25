import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Migration {
  id: string;
  upSql: string;
  downSql: string;
}

export interface MigrationSource {
  load(): Promise<Migration[]>;
}

export interface SqlExecutor {
  execute(sql: string): Promise<void>;
}

export interface MigrationStateStore {
  listAppliedMigrationIds(): Promise<string[]>;
  markApplied(migrationId: string): Promise<void>;
  markRolledBack(migrationId: string): Promise<void>;
}

export interface MigrationRunnerOptions {
  source: MigrationSource;
  sqlExecutor: SqlExecutor;
  stateStore: MigrationStateStore;
}

export class MigrationRunner {
  constructor(private readonly options: MigrationRunnerOptions) {}

  async up(): Promise<{ applied: string[] }> {
    const migrations = await this.options.source.load();
    const appliedMigrationIds = new Set(await this.options.stateStore.listAppliedMigrationIds());
    const applied: string[] = [];

    for (const migration of migrations) {
      if (appliedMigrationIds.has(migration.id)) {
        continue;
      }

      await this.options.sqlExecutor.execute(migration.upSql);
      await this.options.stateStore.markApplied(migration.id);
      applied.push(migration.id);
    }

    return { applied };
  }

  async down(): Promise<{ rolledBack?: string }> {
    const migrations = await this.options.source.load();
    const appliedMigrationIds = await this.options.stateStore.listAppliedMigrationIds();

    const latestMigrationId = appliedMigrationIds[appliedMigrationIds.length - 1];
    if (latestMigrationId === undefined) {
      return {};
    }

    const migration = migrations.find((item) => item.id === latestMigrationId);
    if (migration === undefined) {
      throw new Error(`Applied migration not found in source: ${latestMigrationId}`);
    }

    await this.options.sqlExecutor.execute(migration.downSql);
    await this.options.stateStore.markRolledBack(migration.id);

    return { rolledBack: migration.id };
  }
}

export class NoopSqlExecutor implements SqlExecutor {
  public readonly executedSql: string[] = [];

  async execute(sql: string): Promise<void> {
    this.executedSql.push(sql);
  }
}

export class InMemoryMigrationStateStore implements MigrationStateStore {
  private readonly applied = new Set<string>();

  async listAppliedMigrationIds(): Promise<string[]> {
    return Array.from(this.applied).sort();
  }

  async markApplied(migrationId: string): Promise<void> {
    this.applied.add(migrationId);
  }

  async markRolledBack(migrationId: string): Promise<void> {
    this.applied.delete(migrationId);
  }
}

export class FileSystemMigrationSource implements MigrationSource {
  constructor(private readonly migrationsDirectory: string) {}

  async load(): Promise<Migration[]> {
    const fileNames = await readdir(this.migrationsDirectory);
    const migrationIds = new Set<string>();

    for (const fileName of fileNames) {
      if (!fileName.endsWith('.up.sql')) {
        continue;
      }

      migrationIds.add(fileName.replace('.up.sql', ''));
    }

    const migrations: Migration[] = [];

    for (const migrationId of Array.from(migrationIds).sort()) {
      const upSqlPath = join(this.migrationsDirectory, `${migrationId}.up.sql`);
      const downSqlPath = join(this.migrationsDirectory, `${migrationId}.down.sql`);

      const [upSql, downSql] = await Promise.all([
        readFile(upSqlPath, 'utf8'),
        readFile(downSqlPath, 'utf8'),
      ]);

      migrations.push({
        id: migrationId,
        upSql,
        downSql,
      });
    }

    return migrations;
  }
}