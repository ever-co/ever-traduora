import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';
import { createTables, dropTables, engineColumnName, quoteName, TableSpec } from '../utils/ever-platform-tables';

/**
 * Billing (DESIGN §3.7, §4.1, §4.5, P4): the billing columns of `organization` and the `billing_event` table of the
 * webhook. Only adds a table, columns and an index; no existing value changes. Safe to run again after an interruption
 * (MySQL commits each DDL statement on its own): every step looks before it writes.
 */

interface ColumnDef {
  name: string;
  /** The type per engine */
  type: Record<DbType.POSTGRES | DbType.MYSQL | DbType.BETTER_SQLITE3, string>;
}

const varchar = (length: number) => ({
  [DbType.POSTGRES]: `varchar(${length}) NULL`,
  [DbType.MYSQL]: `varchar(${length}) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL`,
  [DbType.BETTER_SQLITE3]: `varchar(${length}) NULL`,
});

const timestamp = {
  [DbType.POSTGRES]: 'timestamp(6) NULL',
  [DbType.MYSQL]: 'timestamp(6) NULL DEFAULT NULL',
  [DbType.BETTER_SQLITE3]: 'datetime NULL',
};

const counter = {
  [DbType.POSTGRES]: 'integer NOT NULL DEFAULT 0',
  [DbType.MYSQL]: 'int NOT NULL DEFAULT 0',
  [DbType.BETTER_SQLITE3]: 'integer NOT NULL DEFAULT 0',
};

/** The columns P4 adds to `organization` (DESIGN §4.1), snake_case (camelCase on MySQL) */
const ORGANIZATION_COLUMNS: ColumnDef[] = [
  { name: 'stripe_customer_id', type: varchar(255) },
  { name: 'stripe_subscription_id', type: varchar(255) },
  { name: 'billing_status', type: varchar(32) },
  { name: 'billing_interval', type: varchar(16) },
  { name: 'extra_seats', type: counter },
  { name: 'trial_ends_at', type: timestamp },
  { name: 'current_period_end', type: timestamp },
  { name: 'past_due_since', type: timestamp },
  { name: 'checkout_session_id', type: varchar(255) },
  { name: 'checkout_expires_at', type: timestamp },
  { name: 'checkout_attempt', type: counter },
];

/** A Stripe customer belongs to one organization (NULLs are not compared on any of the three engines) */
const CUSTOMER_INDEX = 'UQ_organization_stripe_customer_id';

const TABLES: TableSpec[] = [
  {
    name: 'billing_event',
    engineNaming: true,
    columns: [
      { name: 'id', type: 'varchar', length: 255 },
      { name: 'type', type: 'varchar', length: 128 },
      // No foreign key: the log outlives what it names
      { name: 'organization_id', type: 'varchar', length: 255, nullable: true },
      { name: 'outcome', type: 'varchar', length: 64, nullable: true },
      { name: 'date_processed', type: 'timestamp', defaultNow: true },
    ],
    primary: ['id'],
  },
];

const EVENT_INDEX = 'IDX_billing_event_organization_id';

export class addBilling1795572000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const db = engine();
    for (const column of ORGANIZATION_COLUMNS) {
      if (!(await columnExists(queryRunner, db, 'organization', column.name))) {
        await queryRunner.query(`ALTER TABLE ${q(db, 'organization')} ADD ${c(db, column.name)} ${column.type[db]}`);
      }
    }
    await createIndex(queryRunner, db, CUSTOMER_INDEX, 'organization', 'stripe_customer_id', true);
    await createTables(queryRunner, TABLES);
    await createIndex(queryRunner, db, EVENT_INDEX, 'billing_event', 'organization_id', false);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const db = engine();
    await dropTables(queryRunner, TABLES);
    await dropIndex(queryRunner, db, CUSTOMER_INDEX, 'organization');
    for (const column of [...ORGANIZATION_COLUMNS].reverse()) {
      if (await columnExists(queryRunner, db, 'organization', column.name)) {
        await queryRunner.query(`ALTER TABLE ${q(db, 'organization')} DROP COLUMN ${c(db, column.name)}`);
      }
    }
  }
}

type Engine = DbType.POSTGRES | DbType.MYSQL | DbType.BETTER_SQLITE3;

function engine(): Engine {
  const db = config.db.default.type as DbType;
  if (db !== DbType.POSTGRES && db !== DbType.MYSQL && db !== DbType.BETTER_SQLITE3) {
    throw new Error(`Unknown DB type: ${db}`);
  }
  return db;
}

const q = (db: Engine, name: string) => quoteName(db, name);
const c = (db: Engine, name: string) => quoteName(db, engineColumnName(db, name));

async function count(queryRunner: QueryRunner, query: string, params: unknown[]): Promise<number> {
  const rows = await queryRunner.query(query, params);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row ? Number(Object.values(row)[0] ?? 0) : 0;
}

async function columnExists(queryRunner: QueryRunner, db: Engine, table: string, column: string): Promise<boolean> {
  switch (db) {
    case DbType.POSTGRES:
      return (
        (await count(
          queryRunner,
          `SELECT COUNT(*) AS "n" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
          [table, column],
        )) > 0
      );
    case DbType.MYSQL:
      return (
        (await count(
          queryRunner,
          'SELECT COUNT(*) AS `n` FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
          [table, engineColumnName(db, column)],
        )) > 0
      );
    default: {
      const columns: Array<{ name: string }> = await queryRunner.query(`PRAGMA table_info("${table}")`);
      return columns.some(info => info.name === column);
    }
  }
}

async function mysqlIndexExists(queryRunner: QueryRunner, table: string, name: string): Promise<boolean> {
  return (
    (await count(
      queryRunner,
      'SELECT COUNT(*) AS `n` FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
      [table, name],
    )) > 0
  );
}

async function createIndex(queryRunner: QueryRunner, db: Engine, name: string, table: string, column: string, unique: boolean): Promise<void> {
  const kind = unique ? 'UNIQUE INDEX' : 'INDEX';
  const on = `${q(db, table)} (${c(db, column)})`;
  if (db !== DbType.MYSQL) {
    await queryRunner.query(`CREATE ${kind} IF NOT EXISTS ${q(db, name)} ON ${on}`);
  } else if (!(await mysqlIndexExists(queryRunner, table, name))) {
    await queryRunner.query(`CREATE ${kind} ${q(db, name)} ON ${on}`);
  }
}

async function dropIndex(queryRunner: QueryRunner, db: Engine, name: string, table: string): Promise<void> {
  if (db !== DbType.MYSQL) {
    await queryRunner.query(`DROP INDEX IF EXISTS ${q(db, name)}`);
  } else if (await mysqlIndexExists(queryRunner, table, name)) {
    await queryRunner.query(`DROP INDEX ${q(db, name)} ON ${q(db, table)}`);
  }
}
