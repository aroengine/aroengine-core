import { describe, expect, it } from 'vitest';

import {
  InMemoryMigrationStateStore,
  MigrationRunner,
  MigrationSource,
  NoopSqlExecutor,
} from '../../server/migrations/index.js';

class StaticMigrationSource implements MigrationSource {
  async load() {
    return [
      {
        id: '0001',
        upSql: 'CREATE TABLE one(id TEXT);',
        downSql: 'DROP TABLE one;',
      },
      {
        id: '0002',
        upSql: 'CREATE TABLE two(id TEXT);',
        downSql: 'DROP TABLE two;',
      },
    ];
  }
}

describe('MigrationRunner', () => {
  it('applies pending migrations and rolls back latest migration', async () => {
    const sqlExecutor = new NoopSqlExecutor();
    const stateStore = new InMemoryMigrationStateStore();
    const runner = new MigrationRunner({
      source: new StaticMigrationSource(),
      sqlExecutor,
      stateStore,
    });

    const upResult = await runner.up();
    expect(upResult.applied).toEqual(['0001', '0002']);

    const downResult = await runner.down();
    expect(downResult.rolledBack).toBe('0002');
    expect(sqlExecutor.executedSql).toHaveLength(3);
  });
});