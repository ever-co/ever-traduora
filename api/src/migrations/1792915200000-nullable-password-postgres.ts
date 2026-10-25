import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

/**
 * Accounts can have no password: provider sign-ins never set one, and a published password is removed. The
 * providerGoogle migration made the column nullable on MySQL and SQLite but not on PostgreSQL.
 */
export class nullablePasswordPostgres1792915200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (config.db.default.type === DbType.POSTGRES) {
      await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "encrypted_password" DROP NOT NULL;`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (config.db.default.type === DbType.POSTGRES) {
      await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "encrypted_password" SET NOT NULL;`);
    }
  }
}
