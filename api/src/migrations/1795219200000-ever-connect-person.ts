import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';
import { createTableSql, quoteName, TableSpec } from '../utils/ever-platform-tables';

/** The tables, written once: `createTableSql` renders them for postgres, mysql and better-sqlite3. */
const TABLES: TableSpec[] = [
  {
    name: 'ever_connect_person_link',
    columns: [
      { name: 'user_identity_id', type: 'varchar', length: 36 },
      { name: 'user_id', type: 'varchar', length: 36 },
      { name: 'reported_at', type: 'bigint', nullable: true },
      { name: 'tenant_link_id', type: 'varchar', length: 64, nullable: true },
      { name: 'retry_at', type: 'bigint', nullable: true },
      { name: 'updated_at', type: 'bigint' },
    ],
    primary: ['user_identity_id'],
  },
  {
    name: 'ever_connect_person_request',
    columns: [
      { name: 'job_id', type: 'varchar', length: 64 },
      { name: 'kind', type: 'varchar', length: 16 },
      { name: 'result', type: 'varchar', length: 24, nullable: true },
      { name: 'reason_code', type: 'varchar', length: 64, nullable: true },
      { name: 'accounts', type: 'int', default: 0 },
      { name: 'received_at', type: 'bigint' },
      { name: 'answered_at', type: 'bigint', nullable: true },
    ],
    primary: ['job_id'],
  },
  {
    name: 'ever_connect_person_export',
    columns: [
      { name: 'job_id', type: 'varchar', length: 64 },
      { name: 'user_id', type: 'varchar', length: 36 },
      { name: 'bundle_enc', type: 'text' },
      { name: 'created_at', type: 'bigint' },
      { name: 'expires_at', type: 'bigint' },
    ],
    primary: ['job_id', 'user_id'],
  },
];

/**
 * Tables of a person's requests through the optional Ever Platform connection: the person links this installation
 * reported, the receipts of deletion and export requests, and the exports waiting to be downloaded. Creates new tables
 * only; no existing table changes. Times are epoch milliseconds (`bigint`).
 */
export class everConnectPerson1795219200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = config.db.default.type;
    if (dbType !== DbType.POSTGRES && dbType !== DbType.MYSQL && dbType !== DbType.BETTER_SQLITE3) {
      throw new Error(`Unknown DB type: ${dbType}`);
    }
    for (const table of TABLES) {
      await queryRunner.query(createTableSql(dbType, table));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = config.db.default.type;
    for (const table of [...TABLES].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${quoteName(dbType, table.name)}`);
    }
  }
}
