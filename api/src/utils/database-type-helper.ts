import { config } from '../config';
import { ColumnOptions, ColumnType } from 'typeorm';

/**
 * Supported database types
 */
export enum DbType {
  POSTGRES = 'postgres',
  MYSQL = 'mysql',
  BETTER_SQLITE3 = 'better-sqlite3',
}

/**
 * Current database type (cached for performance)
 */
const currentDbType = config.db.default.type as DbType;

/**
 * Checks if the current database type matches a specific type
 * @param type Database type to check
 * @returns true if the current database type matches the specified type
 */
export function isDbType(type: DbType): boolean {
  return currentDbType === type;
}

/**
 * Returns the current database type
 * @returns The current database type
 */
export function getDbType(): string {
  return currentDbType;
}

/**
 * Get column type based on database type
 * @param typeMap Object containing column types for different databases
 * @param defaultOptions Additional column options to merge
 * @returns Column options for current database
 */
function getDbColumnType(
  typeMap: {
    postgres?: string | ColumnType;
    mysql?: string | ColumnType;
    betterSqlite3?: string | ColumnType;
  },
  defaultOptions: Partial<ColumnOptions> = {},
): ColumnOptions {
  let type: string | ColumnType;

  switch (currentDbType) {
    case DbType.POSTGRES:
      type = typeMap.postgres || 'varchar';
      break;
    case DbType.MYSQL:
      type = typeMap.mysql || 'varchar';
      break;
    case DbType.BETTER_SQLITE3:
      type = typeMap.betterSqlite3 || 'varchar';
      break;
    default:
      throw new Error(`Unsupported database type: ${currentDbType}. ` + `Supported types are: ${Object.values(DbType).join(', ')}`);
  }

  return { type: type as ColumnType, ...defaultOptions };
}

/**
 * Helper for binary column types
 */
export const BinaryColumnType = {
  /**
   * Type for encrypted password columns
   */
  encryptedPassword: (): ColumnOptions => {
    return getDbColumnType(
      { postgres: 'bytea', mysql: 'binary', betterSqlite3: 'blob' },
      { nullable: true, ...(isDbType(DbType.MYSQL) ? { length: 60 } : {}) },
    );
  },

  /**
   * Type for encrypted token columns
   */
  encryptedToken: (): ColumnOptions => {
    return getDbColumnType({ postgres: 'bytea', mysql: 'binary', betterSqlite3: 'blob' }, { nullable: true });
  },

  /**
   * Type for encrypted secret columns
   */
  encryptedSecret: (): ColumnOptions => {
    return getDbColumnType({ postgres: 'bytea', mysql: 'binary', betterSqlite3: 'blob' }, { ...(isDbType(DbType.MYSQL) ? { length: 60 } : {}) });
  },
};

/**
 * Helper for enum column types
 */
export const EnumColumnType = {
  /**
   * Type for project role columns
   * @param enumObj Enum object containing possible values
   * @param defaultValue Default role value
   */
  projectRole: <T extends string | number>(enumObj: Record<string, T>, defaultValue: T): ColumnOptions => {
    if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'varchar', nullable: false, default: defaultValue };
    }
    return { type: 'enum', enum: enumObj, nullable: false, default: defaultValue };
  },

  /**
   * Type for invite status columns
   */
  inviteStatus: <T extends string | number>(enumObj: Record<string, T>, defaultValue: T): ColumnOptions => {
    if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'varchar', nullable: false, default: defaultValue };
    }
    return { type: 'enum', enum: enumObj, nullable: false, default: defaultValue };
  },
};

/**
 * Get database-specific ORDER BY clause for consistent lexical ordering
 * @param column The column name to order by
 * @returns The ORDER BY clause with appropriate collation
 */
export function getLexicalOrderClause(column: string): string {
  if (isDbType(DbType.POSTGRES)) return `${column} COLLATE "C"`;
  if (isDbType(DbType.MYSQL)) return `${column} COLLATE utf8mb4_bin`;
  return column; // SQLite default collation is already consistent
}

/**
 * Timestamp precision for PostgreSQL and MySQL
 */
const TIMESTAMP_PRECISION = 6;

/**
 * Interface for SQLite PRAGMA table_info column information
 */
export interface ColumnInfo {
  name: string;
  type?: string;
  notnull?: number;
  dflt_value?: any;
  pk?: number;
}

/**
 * Helper for time column types
 */
export const TimeColumnType = {
  /**
   * Type for date columns
   */
  date: (): ColumnOptions => {
    return getDbColumnType(
      { postgres: 'timestamp', mysql: 'timestamp', betterSqlite3: 'datetime' },
      { nullable: true, ...(isDbType(DbType.POSTGRES) || isDbType(DbType.MYSQL) ? { precision: TIMESTAMP_PRECISION } : {}) },
    );
  },

  /**
   * Type for creation date columns
   */
  createDate: (): ColumnOptions => {
    return getDbColumnType(
      { postgres: 'timestamp', mysql: 'timestamp', betterSqlite3: 'datetime' },
      { ...(isDbType(DbType.POSTGRES) || isDbType(DbType.MYSQL) ? { precision: TIMESTAMP_PRECISION } : {}) },
    );
  },

  /**
   * Type for update date columns
   */
  updateDate: (): ColumnOptions => {
    return getDbColumnType(
      { postgres: 'timestamp', mysql: 'timestamp', betterSqlite3: 'datetime' },
      { ...(isDbType(DbType.POSTGRES) || isDbType(DbType.MYSQL) ? { precision: TIMESTAMP_PRECISION } : {}) },
    );
  },
};

/**
 * Helper for numeric column types
 */
export const NumberColumnType = {
  /**
   * Type for integer columns
   * @param defaultValue Default integer value
   */
  integer: (defaultValue = 0): ColumnOptions => {
    return getDbColumnType({ postgres: 'int', mysql: 'int', betterSqlite3: 'integer' }, { default: defaultValue });
  },
};
