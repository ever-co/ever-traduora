import { MigrationInterface, QueryRunner } from 'typeorm';
import { createTables, dropTables, TableSpec } from '../utils/ever-platform-tables';

/** The table, written once: `createTables` renders it for postgres, mysql and better-sqlite3. */
const TABLES: TableSpec[] = [
  {
    name: 'ever_connect_provision',
    columns: [
      { name: 'jti', type: 'varchar', length: 64 },
      { name: 'state', type: 'varchar', length: 16 },
      { name: 'user_id', type: 'varchar', length: 64, nullable: true },
      { name: 'project_id', type: 'varchar', length: 64, nullable: true },
      { name: 'instance_id', type: 'varchar', length: 64, nullable: true },
      { name: 'audited', type: 'boolean', default: 0 },
      { name: 'audit_claimed_at', type: 'bigint', nullable: true },
      { name: 'org_id', type: 'varchar', length: 64, nullable: true },
      { name: 'tenant_link_id', type: 'varchar', length: 64, nullable: true },
      { name: 'pending_complete', type: 'boolean', default: 0 },
      { name: 'complete_refused', type: 'varchar', length: 48, nullable: true },
      { name: 'at', type: 'bigint' },
    ],
    primary: ['jti'],
  },
];

/**
 * The answers to provisioning intents from app.ever.co through the optional Ever Platform connection (hand-off). Creates
 * a new table only; no existing table changes. Times are epoch milliseconds.
 */
export class everConnectProvision1795392000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createTables(queryRunner, TABLES);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropTables(queryRunner, TABLES);
  }
}
