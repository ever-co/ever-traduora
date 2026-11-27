import { QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from './database-type-helper';

/**
 * New tables, described once and rendered as `CREATE TABLE IF NOT EXISTS` for postgres, mysql and better-sqlite3.
 *
 * The tables of the optional Ever Platform modules use explicit snake_case column names, so every database has the
 * same columns. Tables of entities that follow the engine's naming strategy (`engineNaming`, e.g. the organizations)
 * are written in snake_case too, and rendered in camelCase on MySQL, as TypeORM names their columns there.
 */
export interface ColumnSpec {
  name: string;
  type: 'varchar' | 'bigint' | 'int' | 'text' | 'boolean' | 'uuid' | 'timestamp';
  length?: number;
  nullable?: boolean;
  default?: number;
  /** A text default, such as a status. */
  defaultText?: string;
  /** `uuid` only: PostgreSQL fills the id when an insert leaves it out (TypeORM generates it on the other engines). */
  generated?: boolean;
  /** `timestamp` only: defaults to the time of the insert. */
  defaultNow?: boolean;
}

export interface UniqueSpec {
  name: string;
  columns: string[];
}

export interface ForeignKeySpec {
  name: string;
  column: string;
  table: string;
  /** The referenced column, `id` unless named. */
  references?: string;
  onDelete: 'CASCADE' | 'SET NULL';
}

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  primary: string[];
  /** Column names follow the engine's naming strategy: camelCase on MySQL, as written (snake_case) elsewhere. */
  engineNaming?: boolean;
  uniques?: UniqueSpec[];
  foreignKeys?: ForeignKeySpec[];
}

export function quoteName(dbType: string, name: string): string {
  return dbType === DbType.MYSQL ? `\`${name}\`` : `"${name}"`;
}

/** `organization_id` → `organizationId`: the column name TypeORM's default naming strategy gives on MySQL. */
export function camelCaseName(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/** A snake_case column name as the engine names it: camelCase on MySQL, unchanged elsewhere. */
export function engineColumnName(dbType: string, name: string): string {
  return dbType === DbType.MYSQL ? camelCaseName(name) : name;
}

function columnType(dbType: string, column: ColumnSpec): string {
  switch (column.type) {
    case 'varchar':
      return `varchar(${column.length})`;
    case 'int':
      return dbType === DbType.MYSQL ? 'int' : 'integer';
    case 'boolean':
      return dbType === DbType.MYSQL ? 'tinyint' : 'boolean';
    case 'text':
      // An export can outgrow MySQL's 64 KB `text`
      return dbType === DbType.MYSQL ? 'mediumtext' : 'text';
    case 'uuid':
      // The ids of the existing tables: uuid on PostgreSQL, varchar(255) on MySQL, text on SQLite
      return dbType === DbType.POSTGRES ? 'uuid' : 'varchar(255)';
    case 'timestamp':
      return dbType === DbType.BETTER_SQLITE3 ? 'datetime' : 'timestamp(6)';
    default:
      return 'bigint';
  }
}

function defaultClause(dbType: string, column: ColumnSpec): string {
  if (column.type === 'uuid' && column.generated && dbType === DbType.POSTGRES) {
    return ' DEFAULT uuid_generate_v4()';
  }
  if (column.type === 'timestamp' && column.defaultNow) {
    return dbType === DbType.BETTER_SQLITE3 ? ` DEFAULT (datetime('now'))` : ' DEFAULT CURRENT_TIMESTAMP(6)';
  }
  if (column.defaultText !== undefined) {
    return ` DEFAULT '${column.defaultText.replace(/'/g, "''")}'`;
  }
  if (column.default === undefined) {
    return '';
  }
  // PostgreSQL takes no integer default for a boolean column
  const literal = column.type === 'boolean' && dbType === DbType.POSTGRES ? (column.default ? 'TRUE' : 'FALSE') : column.default;
  return ` DEFAULT ${literal}`;
}

export function createTableSql(dbType: string, table: TableSpec): string {
  const name = (column: string) => quoteName(dbType, table.engineNaming ? engineColumnName(dbType, column) : column);
  const columns = table.columns.map(
    column => `${name(column.name)} ${columnType(dbType, column)} ${column.nullable ? 'NULL' : 'NOT NULL'}${defaultClause(dbType, column)}`,
  );
  const key = table.primary.map(name).join(', ');
  const primaryKeyName = quoteName(dbType, 'PK_' + table.name);
  const constraints = [`CONSTRAINT ${primaryKeyName} PRIMARY KEY (${key})`];
  for (const unique of table.uniques ?? []) {
    constraints.push(`CONSTRAINT ${quoteName(dbType, unique.name)} UNIQUE (${unique.columns.map(name).join(', ')})`);
  }
  for (const fk of table.foreignKeys ?? []) {
    const target = `${quoteName(dbType, fk.table)} (${quoteName(dbType, fk.references ?? 'id')})`;
    constraints.push(`CONSTRAINT ${quoteName(dbType, fk.name)} FOREIGN KEY (${name(fk.column)}) REFERENCES ${target} ON DELETE ${fk.onDelete}`);
  }
  const options = dbType === DbType.MYSQL ? ' ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : '';
  return `CREATE TABLE IF NOT EXISTS ${quoteName(dbType, table.name)} (${[...columns, ...constraints].join(', ')})${options}`;
}

/** Creates `tables` (if they do not exist) on the configured database. */
export async function createTables(queryRunner: QueryRunner, tables: TableSpec[]): Promise<void> {
  const dbType = config.db.default.type;
  if (dbType !== DbType.POSTGRES && dbType !== DbType.MYSQL && dbType !== DbType.BETTER_SQLITE3) {
    throw new Error(`Unknown DB type: ${dbType}`);
  }
  for (const table of tables) {
    await queryRunner.query(createTableSql(dbType, table));
  }
}

/** Drops `tables`, last first. */
export async function dropTables(queryRunner: QueryRunner, tables: TableSpec[]): Promise<void> {
  for (const table of [...tables].reverse()) {
    await queryRunner.query(`DROP TABLE IF EXISTS ${quoteName(config.db.default.type, table.name)}`);
  }
}
