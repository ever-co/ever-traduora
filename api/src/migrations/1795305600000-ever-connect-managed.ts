import { MigrationInterface, QueryRunner } from 'typeorm';
import { createTables, dropTables, TableSpec } from '../utils/ever-platform-tables';

/** The tables, written once: `createTables` renders them for postgres, mysql and better-sqlite3. */
const TABLES: TableSpec[] = [
  {
    name: 'ever_connect_managed_policy',
    columns: [
      { name: 'id', type: 'varchar', length: 8 },
      { name: 'opt_in', type: 'boolean', default: 0 },
      { name: 'kinds', type: 'text', nullable: true },
      { name: 'windows', type: 'text', nullable: true },
      { name: 'backup_dir_enc', type: 'text', nullable: true },
      { name: 'updated_at', type: 'bigint' },
      { name: 'updated_by', type: 'varchar', length: 64, nullable: true },
    ],
    primary: ['id'],
  },
  {
    name: 'ever_connect_managed_operation',
    columns: [
      { name: 'operation_id', type: 'varchar', length: 64 },
      { name: 'kind', type: 'varchar', length: 24 },
      { name: 'status', type: 'varchar', length: 16 },
      { name: 'reason', type: 'varchar', length: 48, nullable: true },
      { name: 'size_bytes', type: 'bigint', nullable: true },
      { name: 'request', type: 'text', nullable: true },
      { name: 'unsent_result', type: 'text', nullable: true },
      { name: 'connection_kid', type: 'varchar', length: 64, nullable: true },
      { name: 'not_before', type: 'bigint', nullable: true },
      { name: 'at', type: 'bigint' },
    ],
    primary: ['operation_id'],
  },
];

/**
 * Tables of maintenance operations through the optional Ever Platform connection: the operator's opt-in and the
 * history of requested operations. Creates new tables only; no existing table changes. Times are epoch milliseconds.
 */
export class everConnectManaged1795305600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createTables(queryRunner, TABLES);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropTables(queryRunner, TABLES);
  }
}
