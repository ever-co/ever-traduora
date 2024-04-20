import { DataSource, DataSourceOptions, DefaultNamingStrategy } from 'typeorm';
import * as process from 'process';
import { SnakeNamingStrategy } from '../utils/snake-naming-strategy';

const env = process.env;

/**
 * Retrieves the connection options for TypeORM DataSource or TypeORMModule.
 * @returns The connection options for TypeORM DataSource or TypeORMModule.
 */
export const dataSourceOptions = (): DataSourceOptions => {
  const options: DataSourceOptions = {
    type: (env.TR_DB_TYPE as any) || 'mysql',
    host: env.TR_DB_HOST || 'localhost',
    port: parseInt(env.TR_DB_PORT, 10) || 3306,
    username: env.TR_DB_USER || 'root',
    password: env.TR_DB_PASSWORD || 'root',
    database: env.TR_DB_DATABASE || 'tr_dev',
    charset: 'utf8mb4',
    synchronize: false,
    logging: false,
    entities: ['src/entity/*.entity*'],
    migrations: ['src/migrations/*'],
    namingStrategy: env.TR_DB_TYPE === 'postgres' ? new SnakeNamingStrategy() : new DefaultNamingStrategy(),
  };
  return options;
};

/**
 * Creates and initializes a TypeORM DataSource instance with the provided configuration options.
 * @returns Initialized TypeORM DataSource instance.
 */
export const getDataSourceConnection = async (): Promise<DataSource> => {
  const dataSource = new DataSource(dataSourceOptions());

  try {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
  } catch (error) {
    console.error(error?.message);
  }

  return dataSource;
};
