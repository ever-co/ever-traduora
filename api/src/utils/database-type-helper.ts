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
 * Checks if the current database type matches a specific type
 * @param type Database type to check
 * @returns true if the current database type matches the specified type
 */
export function isDbType(type: DbType): boolean {
  return config.db.default.type === type;
}

/**
 * Returns the current database type
 * @returns The current database type
 */
export function getDbType(): string {
  return config.db.default.type;
}

/**
 * Helper for binary column types
 */
export const BinaryColumnType = {
  /**
   * Type for encrypted password columns
   */
  encryptedPassword: (): ColumnOptions => {
    if (isDbType(DbType.POSTGRES)) {
      return { type: 'bytea' as ColumnType, nullable: true };
    } else if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'blob' as ColumnType, nullable: true };
    } else {
      return { type: 'binary' as ColumnType, length: 60, nullable: true };
    }
  },

  /**
   * Type for encrypted token columns
   */
  encryptedToken: (): ColumnOptions => {
    if (isDbType(DbType.POSTGRES)) {
      return { type: 'bytea' as ColumnType, nullable: true };
    } else if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'blob' as ColumnType, nullable: true };
    } else {
      return { type: 'binary' as ColumnType, nullable: true };
    }
  },

  /**
   * Type for encrypted secret columns
   */
  encryptedSecret: (): ColumnOptions => {
    if (isDbType(DbType.POSTGRES)) {
      return { type: 'bytea' as ColumnType };
    } else if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'blob' as ColumnType };
    } else {
      return { type: 'binary' as ColumnType, length: 60 };
    }
  },
};

/**
 * Helper for enum column types
 */
export const EnumColumnType = {
  /**
   * Type for project role columns
   * @param defaultValue Default role value
   */
  projectRole: (defaultValue: any): ColumnOptions => {
    if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'varchar' as ColumnType, nullable: false, default: defaultValue };
    } else {
      return { type: 'enum' as ColumnType, enum: defaultValue.constructor, nullable: false, default: defaultValue };
    }
  },

  /**
   * Type for invite status columns
   * @param defaultValue Default status value
   */
  inviteStatus: (defaultValue: any): ColumnOptions => {
    if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'varchar' as ColumnType, nullable: false, default: defaultValue };
    } else {
      return { type: 'enum' as ColumnType, enum: defaultValue.constructor, nullable: false, default: defaultValue };
    }
  },
};

/**
 * Helper for time column types
 */
export const TimeColumnType = {
  /**
   * Type for date columns
   */
  date: (): ColumnOptions => {
    if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'datetime' as ColumnType, nullable: true };
    } else {
      return { type: 'timestamp' as ColumnType, nullable: true, precision: 6 };
    }
  },

  /**
   * Type for creation date columns
   */
  createDate: (): ColumnOptions => {
    if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'datetime' as ColumnType };
    } else {
      return { type: 'timestamp' as ColumnType };
    }
  },

  /**
   * Type for update date columns
   */
  updateDate: (): ColumnOptions => {
    if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'datetime' as ColumnType };
    } else {
      return { type: 'timestamp' as ColumnType };
    }
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
  integer: (defaultValue: number = 0): ColumnOptions => {
    if (isDbType(DbType.BETTER_SQLITE3)) {
      return { type: 'integer' as ColumnType, default: defaultValue };
    } else {
      return { type: 'int' as ColumnType, default: defaultValue };
    }
  },
};
