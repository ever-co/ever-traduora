import { DataSource, DataSourceOptions, DefaultNamingStrategy } from 'typeorm';
import * as process from 'process';
import { SnakeNamingStrategy } from '../utils/snake-naming-strategy';
import * as path from 'path';

const env = process.env;

/**
 * Retrieves the connection options for TypeORM DataSource or TypeORMModule.
 *
 * @returns The connection options for TypeORM DataSource or TypeORMModule.
 */
export const dataSourceOptions = (): DataSourceOptions => {
  // Safely cast the database type or default to 'better-sqlite3'
  const dbType = (env.TR_DB_TYPE as any) || 'better-sqlite3';

  // Common options for all database types
  const commonOptions = {
    synchronize: false,
    logging: false,
    entities: [__dirname + '/../entity/*.entity.{js,ts}'],
    migrations: [__dirname + '/../migrations/*.{js,ts}'],
  };

  // Handle SQLite configuration
  if (dbType === 'better-sqlite3' || dbType === 'sqlite') {
    return {
      ...commonOptions,
      type: 'better-sqlite3',
      database: env.TR_DB_DATABASE || path.resolve(process.cwd(), 'tr_dev.sqlite'),
      // SQLite-specific options
      foreignKeys: true,
      // Enable WAL mode for better concurrency
      enableWAL: true,
    } as DataSourceOptions;
  }

  // Handle MySQL or PostgreSQL configuration
  // Parse the port safely with fallback to 3306 if parsing fails
  const parsedPort = parseInt(env.TR_DB_PORT, 10);
  const port = Number.isNaN(parsedPort) ? 3306 : parsedPort;

  // Base options object for MySQL/PostgreSQL
  const options: DataSourceOptions = {
    ...commonOptions,
    type: dbType,
    host: env.TR_DB_HOST || '127.0.0.1',
    port,
    username: env.TR_DB_USER || 'root',
    password: env.TR_DB_PASSWORD || '',
    database: env.TR_DB_DATABASE || 'tr_dev',
    charset: dbType === 'mysql' ? 'utf8mb4' : undefined,
    namingStrategy: dbType === 'postgres' ? new SnakeNamingStrategy() : new DefaultNamingStrategy(),
  };

  return options;
};

/**
 * Creates and initializes a TypeORM DataSource instance with the provided configuration options.
 *
 * @returns Initialized TypeORM DataSource instance.
 */
let dataSource: DataSource;
export const getDataSourceConnection = async (): Promise<DataSource> => {
  if (!dataSource) {
    dataSource = new DataSource(dataSourceOptions());
  }

  try {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
  } catch (error) {
    console.error(`Error initializing database connection: ${error?.message}`);
  }

  return dataSource;
};
