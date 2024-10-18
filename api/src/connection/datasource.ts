import { DataSource, DataSourceOptions, DefaultNamingStrategy } from 'typeorm';
import * as process from 'process';
import { SnakeNamingStrategy } from '../utils/snake-naming-strategy';

const env = process.env;

/**
 * Retrieves the connection options for TypeORM DataSource or TypeORMModule.
 *
 * @returns The connection options for TypeORM DataSource or TypeORMModule.
 */
export const dataSourceOptions = (): DataSourceOptions => {
    // Safely cast the database type or default to 'mysql'
    const dbType = (env.TR_DB_TYPE as any) || 'mysql';

    // Parse the port safely with fallback to 3306 if parsing fails
    const parsedPort = parseInt(env.TR_DB_PORT, 10);
    const port = Number.isNaN(parsedPort) ? 3306 : parsedPort;

    // Base options object using the more generic DataSourceOptions
    const options: DataSourceOptions = {
      type: dbType,
      host: env.TR_DB_HOST || 'localhost',
      port,
      username: env.TR_DB_USER || 'root',
      password: env.TR_DB_PASSWORD || 'root',
      database: env.TR_DB_DATABASE || 'tr_dev',
      charset: 'utf8mb4',
      synchronize: false,
      logging: false,
      entities: [__dirname + '/../entity/*.entity.{js,ts}'],
      migrations: [__dirname + '/../migrations/*.{js,ts}'],
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
