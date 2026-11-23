import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';
import { quoteName } from '../utils/ever-platform-tables';

const TABLE = 'ever_connect_provision';
/** The two columns the background round looks up (`audited = false`, `pending_complete = true`), one index each. */
const AUDITED = { name: 'IDX_ever_connect_provision_audited', column: 'audited' };
const PENDING_COMPLETE = { name: 'IDX_ever_connect_provision_pending_complete', column: 'pending_complete' };

type IndexSpec = typeof AUDITED;

/**
 * Indexes for the background round of provisioning (`retryPendingCompletes`): the table keeps every answered intent, so
 * the lookups of the unfinished ones do not read the whole history. Creates indexes only; no data changes.
 *
 * Safe to run again after an interruption: MySQL commits each CREATE / DROP INDEX on its own (and has no `IF [NOT]
 * EXISTS` for them), so there each index is looked up first; PostgreSQL and SQLite use `IF [NOT] EXISTS`.
 */
export class EverConnectProvisionIndexes1795395600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createIndex(queryRunner, AUDITED);
    await createIndex(queryRunner, PENDING_COMPLETE);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropIndex(queryRunner, PENDING_COMPLETE);
    await dropIndex(queryRunner, AUDITED);
  }
}

async function createIndex(queryRunner: QueryRunner, index: IndexSpec): Promise<void> {
  const dbType = config.db.default.type;
  const name = quoteName(dbType, index.name);
  const on = `${quoteName(dbType, TABLE)} (${quoteName(dbType, index.column)})`;
  if (dbType !== DbType.MYSQL) {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${on}`);
  } else if (!(await mysqlIndexExists(queryRunner, index.name))) {
    await queryRunner.query(`CREATE INDEX ${name} ON ${on}`);
  }
}

async function dropIndex(queryRunner: QueryRunner, index: IndexSpec): Promise<void> {
  const dbType = config.db.default.type;
  const name = quoteName(dbType, index.name);
  if (dbType !== DbType.MYSQL) {
    await queryRunner.query(`DROP INDEX IF EXISTS ${name}`);
  } else if (await mysqlIndexExists(queryRunner, index.name)) {
    await queryRunner.query(`DROP INDEX ${name} ON ${quoteName(dbType, TABLE)}`);
  }
}

async function mysqlIndexExists(queryRunner: QueryRunner, indexName: string): Promise<boolean> {
  const rows = await queryRunner.query(
    'SELECT COUNT(*) AS `n` FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
    [TABLE, indexName],
  );
  return Number(rows?.[0]?.n ?? 0) > 0;
}
