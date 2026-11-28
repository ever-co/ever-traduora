import { MigrationInterface, QueryRunner } from 'typeorm';
import { createTables, dropTables, TableSpec } from '../utils/ever-platform-tables';

/**
 * `organization_billing_cancellation` (DESIGN §3.9): the outbox of a deleted organization's subscription cancellation,
 * written in the deletion's transaction and tried after it commits; a failed one waits there for an operator. One row
 * per organization, keyed by its id, without a foreign key (organizations are only marked `deleted`). Rendered for
 * postgres, mysql and better-sqlite3, snake_case columns (camelCase on MySQL).
 */
const TABLES: TableSpec[] = [
  {
    name: 'organization_billing_cancellation',
    engineNaming: true,
    columns: [
      { name: 'organization_id', type: 'uuid' },
      { name: 'status', type: 'varchar', length: 16, defaultText: 'pending' },
      { name: 'attempts', type: 'int', default: 0 },
      { name: 'last_error', type: 'varchar', length: 500, nullable: true },
      { name: 'date_created', type: 'timestamp', defaultNow: true },
      { name: 'date_modified', type: 'timestamp', defaultNow: true },
    ],
    primary: ['organization_id'],
  },
];

/** Creates the table; safe to run again. */
export class AddOrganizationBillingCancellation1795867300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createTables(queryRunner, TABLES);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropTables(queryRunner, TABLES);
  }
}
