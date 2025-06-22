import { snakeCase } from 'typeorm/util/StringUtils';
import { config } from '../config';
import { DbType } from './database-type-helper';

// TypeORM fails to properly quote camelCase aliases with PostgreSQL
// https://github.com/typeorm/typeorm/issues/10961
export const resolveColumnName = (columnName: string): string => {
  if (!columnName) {
    throw new Error('Column name cannot be empty');
  }

  //  convert for postgres and sqlite
  if (config.db.default.type === DbType.POSTGRES || config.db.default.type === DbType.BETTER_SQLITE3) {
    return snakeCase(columnName);
  }

  return columnName;
};
