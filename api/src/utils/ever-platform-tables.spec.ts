import { DbType } from './database-type-helper';
import { createTableSql, TableSpec } from './ever-platform-tables';

describe('ever-platform-tables', () => {
  const table: TableSpec = {
    name: 't',
    columns: [
      { name: 'id', type: 'varchar', length: 8 },
      { name: 'on', type: 'boolean', default: 0 },
      { name: 'count', type: 'int', default: 0 },
      { name: 'body', type: 'text', nullable: true },
    ],
    primary: ['id'],
  };

  it('renders one table for each database', () => {
    expect(createTableSql(DbType.POSTGRES, table)).toBe(
      'CREATE TABLE IF NOT EXISTS "t" ("id" varchar(8) NOT NULL, "on" boolean NOT NULL DEFAULT FALSE, "count" integer NOT NULL DEFAULT 0, ' +
        '"body" text NULL, CONSTRAINT "PK_t" PRIMARY KEY ("id"))',
    );
    expect(createTableSql(DbType.MYSQL, table)).toBe(
      'CREATE TABLE IF NOT EXISTS `t` (`id` varchar(8) NOT NULL, `on` tinyint NOT NULL DEFAULT 0, `count` int NOT NULL DEFAULT 0, ' +
        '`body` mediumtext NULL, CONSTRAINT `PK_t` PRIMARY KEY (`id`)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    );
    expect(createTableSql(DbType.BETTER_SQLITE3, table)).toBe(
      'CREATE TABLE IF NOT EXISTS "t" ("id" varchar(8) NOT NULL, "on" boolean NOT NULL DEFAULT 0, "count" integer NOT NULL DEFAULT 0, ' +
        '"body" text NULL, CONSTRAINT "PK_t" PRIMARY KEY ("id"))',
    );
  });

  it('renders a primary key of two columns', () => {
    const exports: TableSpec = {
      name: 'x',
      columns: [
        { name: 'job_id', type: 'varchar', length: 64 },
        { name: 'user_id', type: 'varchar', length: 36 },
      ],
      primary: ['job_id', 'user_id'],
    };
    expect(createTableSql(DbType.BETTER_SQLITE3, exports)).toBe(
      'CREATE TABLE IF NOT EXISTS "x" ("job_id" varchar(64) NOT NULL, "user_id" varchar(36) NOT NULL, CONSTRAINT "PK_x" PRIMARY KEY ("job_id", "user_id"))',
    );
  });
});
