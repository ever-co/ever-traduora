import { snakeCase } from 'typeorm/util/StringUtils';
import { config } from '../config';

// TypeORM fails to properly quote camelCase aliases with PostgreSQL
// https://github.com/typeorm/typeorm/issues/10961
export const resolveColumnName = (columnName: string): string => {
  // Convert the column name to snake_case if needed
  if (config.db.default.type === 'postgres') {
    return snakeCase(columnName);
  }

  return columnName;
}
