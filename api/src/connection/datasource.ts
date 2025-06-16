import { DataSource, DataSourceOptions, DefaultNamingStrategy } from 'typeorm';
import * as process from 'process';
import { SnakeNamingStrategy } from '../utils/snake-naming-strategy';
import * as path from 'path';
import * as fs from 'fs';
import { DbType } from '../utils/database-type-helper';

const env = process.env;

/**
 * Retrieves the connection options for TypeORM DataSource or TypeORMModule.
 *
 * @returns The connection options for TypeORM DataSource or TypeORMModule.
 */
export const dataSourceOptions = (): DataSourceOptions => {
  // Parse the database type with proper type validation
  const dbTypeInput = env.TR_DB_TYPE || DbType.MYSQL;

  // Validate that the provided DB type is supported
  const dbType = Object.values(DbType).includes(dbTypeInput as DbType) ? (dbTypeInput as DbType) : DbType.BETTER_SQLITE3;

  // Common options for all database types
  const commonOptions = {
    synchronize: false,
    logging: false,
    entities: [`${__dirname}/../entity/*.entity.{js,ts}`],
    migrations: [`${__dirname}/../migrations/*.{js,ts}`],
  };

  // Handle SQLite configuration
  if (dbType === DbType.BETTER_SQLITE3) {
    // Ensure SQLite directory exists
    const dbPath = env.TR_DB_SQLITE_PATH || 'data/tr_dev.sqlite3';
    const resolvedPath = path.resolve(process.cwd(), dbPath);
    const dbDir = path.dirname(resolvedPath);

    if (!fs.existsSync(dbDir)) {
      console.log(`Creating SQLite database directory: ${dbDir}`);
      try {
        fs.mkdirSync(dbDir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create database directory: ${error.message}`);
        throw error;
      }
    }

    return {
      ...commonOptions,
      type: DbType.BETTER_SQLITE3,
      database: resolvedPath,
      foreignKeys: true,
      namingStrategy: new SnakeNamingStrategy(),
    } as DataSourceOptions;
  }

  // Handle MySQL or PostgreSQL configuration
  // Parse the port safely with fallback to default ports based on DB type
  const parsedPort = parseInt(env.TR_DB_PORT, 10);
  const defaultPort = dbType === DbType.POSTGRES ? 5432 : 3306;
  const port = Number.isNaN(parsedPort) ? defaultPort : parsedPort;

  // Base options object for MySQL/PostgreSQL
  const options: DataSourceOptions = {
    ...commonOptions,
    type: dbType,
    host: env.TR_DB_HOST || '127.0.0.1',
    port,
    username: env.TR_DB_USER || 'root',
    password: env.TR_DB_PASSWORD || '',
    database: env.TR_DB_DATABASE || 'tr_dev',
    charset: dbType === DbType.MYSQL ? 'utf8mb4' : undefined,
    namingStrategy: dbType === DbType.POSTGRES ? new SnakeNamingStrategy() : new DefaultNamingStrategy(),
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
      console.log(`Successfully connected to ${dataSource.options.type} database`);
    }
  } catch (error) {
    console.error(`Error initializing database connection: ${error?.message}`);
    throw error; // Re-throw to allow proper error handling upstream
  }

  return dataSource;
};
