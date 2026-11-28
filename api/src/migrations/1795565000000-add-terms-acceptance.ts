import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

/**
 * The terms of service and privacy policy versions a person accepted, and when (DESIGN §3.8, §4.5). Existing accounts
 * start with none: in SaaS mode they are asked to accept at their next request, a single-tenant install never asks.
 */
export class addTermsAcceptance1795565000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `ALTER TABLE "user" ADD COLUMN terms_version VARCHAR(64) DEFAULT NULL, ` +
            `ADD COLUMN privacy_version VARCHAR(64) DEFAULT NULL, ` +
            `ADD COLUMN terms_accepted_at TIMESTAMP(6) DEFAULT NULL;`,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'ALTER TABLE `user` ADD COLUMN `termsVersion` VARCHAR(64) NULL DEFAULT NULL, ' +
            'ADD COLUMN `privacyVersion` VARCHAR(64) NULL DEFAULT NULL, ' +
            'ADD COLUMN `termsAcceptedAt` TIMESTAMP(6) NULL DEFAULT NULL',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "terms_version" VARCHAR(64) DEFAULT NULL');
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "privacy_version" VARCHAR(64) DEFAULT NULL');
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "terms_accepted_at" DATETIME DEFAULT NULL');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN terms_version, DROP COLUMN privacy_version, DROP COLUMN terms_accepted_at;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `termsVersion`, DROP COLUMN `privacyVersion`, DROP COLUMN `termsAcceptedAt`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "terms_version"');
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "privacy_version"');
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "terms_accepted_at"');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
