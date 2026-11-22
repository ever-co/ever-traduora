import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';
import { quoteName } from '../utils/ever-platform-tables';

/** The two columns the background round looks up (`audited = false`, `pending_complete = true`), one index each. */
const INDEXES = [
  { name: 'IDX_ever_connect_provision_audited', column: 'audited' },
  { name: 'IDX_ever_connect_provision_pending_complete', column: 'pending_complete' },
];

/**
 * Indexes for the background round of provisioning (`retryPendingCompletes`): the table keeps every answered intent, so
 * the lookups of the unfinished ones do not read the whole history. Creates indexes only; no data changes.
 */
export class everConnectProvisionIndexes1795395600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = config.db.default.type;
    for (const index of INDEXES) {
      const name = quoteName(dbType, index.name);
      const on = `${quoteName(dbType, 'ever_connect_provision')} (${quoteName(dbType, index.column)})`;
      // MySQL has no CREATE INDEX IF NOT EXISTS; a migration runs once
      await queryRunner.query(dbType === DbType.MYSQL ? `CREATE INDEX ${name} ON ${on}` : `CREATE INDEX IF NOT EXISTS ${name} ON ${on}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = config.db.default.type;
    for (const index of [...INDEXES].reverse()) {
      const name = quoteName(dbType, index.name);
      await queryRunner.query(
        dbType === DbType.MYSQL ? `DROP INDEX ${name} ON ${quoteName(dbType, 'ever_connect_provision')}` : `DROP INDEX IF EXISTS ${name}`,
      );
    }
  }
}
