import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from '../src/config';
import { SnakeNamingStrategy } from '../src/utils/snake-naming-strategy';

/**
 * Unit specs that need a database run the real migrations on an in-memory SQLite database. The migrations follow
 * TR_DB_TYPE, so only when it is SQLite (the default); the e2e suites cover the other databases.
 */
export const describeOnSqlite = config.db.default.type === 'better-sqlite3' ? describe : describe.skip;

/** An in-memory SQLite database with every entity and every migration applied. */
export async function memoryDatabase(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    foreignKeys: true,
    entities: [join(__dirname, '../src/entity/*.entity.ts')],
    migrations: [join(__dirname, '../src/migrations/*.ts')],
    namingStrategy: new SnakeNamingStrategy(),
    logging: false,
  } as DataSourceOptions);
  await dataSource.initialize();
  await dataSource.runMigrations();
  return dataSource;
}
