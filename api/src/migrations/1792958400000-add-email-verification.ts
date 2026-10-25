import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addEmailVerification1792958400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing accounts start unverified: nothing proved that their owners read these emails
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `ALTER TABLE "user" ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE, ` +
            `ADD COLUMN email_verification_token_hash VARCHAR(64) DEFAULT NULL, ` +
            `ADD COLUMN email_verification_expires TIMESTAMP(6) DEFAULT NULL;`,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'ALTER TABLE `user` ADD COLUMN `emailVerified` TINYINT NOT NULL DEFAULT 0 AFTER `passwordResetExpires`, ' +
            'ADD COLUMN `emailVerificationTokenHash` VARCHAR(64) NULL DEFAULT NULL AFTER `emailVerified`, ' +
            'ADD COLUMN `emailVerificationExpires` TIMESTAMP(6) NULL DEFAULT NULL AFTER `emailVerificationTokenHash`',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT 0');
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "email_verification_token_hash" VARCHAR(64) DEFAULT NULL');
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "email_verification_expires" DATETIME DEFAULT NULL');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `ALTER TABLE "user" DROP COLUMN email_verified, DROP COLUMN email_verification_token_hash, DROP COLUMN email_verification_expires;`,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'ALTER TABLE `user` DROP COLUMN `emailVerified`, DROP COLUMN `emailVerificationTokenHash`, DROP COLUMN `emailVerificationExpires`',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "email_verified"');
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "email_verification_token_hash"');
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "email_verification_expires"');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
