import { DbType } from './database-type-helper';
import { camelCaseName, createTableSql, engineColumnName, TableSpec } from './ever-platform-tables';

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

describe('tables that follow the engine naming', () => {
  const table: TableSpec = {
    name: 'member',
    engineNaming: true,
    columns: [
      { name: 'id', type: 'uuid', generated: true },
      { name: 'organization_id', type: 'uuid' },
      { name: 'role', type: 'varchar', length: 16, defaultText: "o'k" },
      { name: 'date_created', type: 'timestamp', defaultNow: true },
    ],
    primary: ['id'],
    uniques: [{ name: 'UQ_member', columns: ['organization_id', 'role'] }],
    foreignKeys: [{ name: 'FK_member_organization', column: 'organization_id', table: 'organization', onDelete: 'CASCADE' }],
  };

  it('renders snake_case names, camelCase on MySQL, with ids, timestamps, uniques and foreign keys', () => {
    expect(createTableSql(DbType.POSTGRES, table)).toBe(
      'CREATE TABLE IF NOT EXISTS "member" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, ' +
        `"role" varchar(16) NOT NULL DEFAULT 'o''k', "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ` +
        'CONSTRAINT "PK_member" PRIMARY KEY ("id"), CONSTRAINT "UQ_member" UNIQUE ("organization_id", "role"), ' +
        'CONSTRAINT "FK_member_organization" FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") ON DELETE CASCADE)',
    );
    expect(createTableSql(DbType.MYSQL, table)).toBe(
      'CREATE TABLE IF NOT EXISTS `member` (`id` varchar(255) NOT NULL, `organizationId` varchar(255) NOT NULL, ' +
        "`role` varchar(16) NOT NULL DEFAULT 'o''k', `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), " +
        'CONSTRAINT `PK_member` PRIMARY KEY (`id`), CONSTRAINT `UQ_member` UNIQUE (`organizationId`, `role`), ' +
        'CONSTRAINT `FK_member_organization` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE) ' +
        'ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    );
    expect(createTableSql(DbType.BETTER_SQLITE3, table)).toBe(
      'CREATE TABLE IF NOT EXISTS "member" ("id" varchar(255) NOT NULL, "organization_id" varchar(255) NOT NULL, ' +
        `"role" varchar(16) NOT NULL DEFAULT 'o''k', "date_created" datetime NOT NULL DEFAULT (datetime('now')), ` +
        'CONSTRAINT "PK_member" PRIMARY KEY ("id"), CONSTRAINT "UQ_member" UNIQUE ("organization_id", "role"), ' +
        'CONSTRAINT "FK_member_organization" FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") ON DELETE CASCADE)',
    );
  });

  it('turns snake_case into the MySQL names', () => {
    expect(camelCaseName('admins_see_all_projects')).toBe('adminsSeeAllProjects');
    expect(engineColumnName(DbType.MYSQL, 'organization_id')).toBe('organizationId');
    expect(engineColumnName(DbType.POSTGRES, 'organization_id')).toBe('organization_id');
  });
});
