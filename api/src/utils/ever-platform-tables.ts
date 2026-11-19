import { DbType } from './database-type-helper';

/**
 * New tables of the optional Ever Platform modules, described once and rendered as `CREATE TABLE IF NOT EXISTS` for
 * postgres, mysql and better-sqlite3 (explicit snake_case column names, so every database has the same columns).
 */
export interface ColumnSpec {
  name: string;
  type: 'varchar' | 'bigint' | 'int' | 'text';
  length?: number;
  nullable?: boolean;
  default?: number;
}

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  primary: string[];
}

export function quoteName(dbType: string, name: string): string {
  return dbType === DbType.MYSQL ? `\`${name}\`` : `"${name}"`;
}

function columnType(dbType: string, column: ColumnSpec): string {
  switch (column.type) {
    case 'varchar':
      return `varchar(${column.length})`;
    case 'int':
      return dbType === DbType.MYSQL ? 'int' : 'integer';
    case 'text':
      // An export can outgrow MySQL's 64 KB `text`
      return dbType === DbType.MYSQL ? 'mediumtext' : 'text';
    default:
      return 'bigint';
  }
}

export function createTableSql(dbType: string, table: TableSpec): string {
  const columns = table.columns.map(column => {
    const defaultValue = column.default === undefined ? '' : ` DEFAULT ${column.default}`;
    return `${quoteName(dbType, column.name)} ${columnType(dbType, column)} ${column.nullable ? 'NULL' : 'NOT NULL'}${defaultValue}`;
  });
  const key = table.primary.map(name => quoteName(dbType, name)).join(', ');
  const primary = `CONSTRAINT ${quoteName(dbType, `PK_${table.name}`)} PRIMARY KEY (${key})`;
  const options = dbType === DbType.MYSQL ? ' ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : '';
  return `CREATE TABLE IF NOT EXISTS ${quoteName(dbType, table.name)} (${[...columns, primary].join(', ')})${options}`;
}
