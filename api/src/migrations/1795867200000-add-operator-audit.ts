import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';
import { createTables, dropTables, engineColumnName, quoteName, TableSpec } from '../utils/ever-platform-tables';

/**
 * `operator_audit` (DESIGN §3.9, §4.5): every action of an installation operator on an organization (suspend, restore),
 * written in the transaction of the action. Rendered for postgres, mysql and better-sqlite3, snake_case columns
 * (camelCase on MySQL, as TypeORM names them there). No foreign keys: a row outlives the operator's account, and an
 * organization is never removed, only marked `deleted`.
 */
const TABLES: TableSpec[] = [
  {
    name: 'operator_audit',
    engineNaming: true,
    columns: [
      { name: 'id', type: 'uuid', generated: true },
      { name: 'operator_user_id', type: 'uuid' },
      { name: 'operator_email', type: 'varchar', length: 255 },
      { name: 'action', type: 'varchar', length: 32 },
      { name: 'organization_id', type: 'uuid' },
      { name: 'reason', type: 'varchar', length: 500 },
      { name: 'date_created', type: 'timestamp', defaultNow: true },
    ],
    primary: ['id'],
  },
];

/** The log is read newest first, overall and per organization. */
const INDEXES = [
  { name: 'IDX_operator_audit_organization_id', column: 'organization_id' },
  { name: 'IDX_operator_audit_date_created', column: 'date_created' },
];

/** Creates the table and its indexes; safe to run again (MySQL commits each DDL statement on its own). */
export class addOperatorAudit1795867200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createTables(queryRunner, TABLES);
    const db = config.db.default.type;
    for (const index of INDEXES) {
      const on = `${quoteName(db, 'operator_audit')} (${quoteName(db, engineColumnName(db, index.column))})`;
      if (db !== DbType.MYSQL) {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS ${quoteName(db, index.name)} ON ${on}`);
      } else if (!(await mysqlIndexExists(queryRunner, index.name))) {
        await queryRunner.query(`CREATE INDEX ${quoteName(db, index.name)} ON ${on}`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The indexes go with the table
    await dropTables(queryRunner, TABLES);
  }
}

async function mysqlIndexExists(queryRunner: QueryRunner, name: string): Promise<boolean> {
  const rows = await queryRunner.query(
    'SELECT COUNT(*) AS `n` FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
    ['operator_audit', name],
  );
  return Number(rows?.[0]?.n ?? 0) > 0;
}
