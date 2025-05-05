import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class removeTosAndPrivacy1552494719664 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_date";`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_version";`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedDate`');
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedVersion`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_date"');
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_version"');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" varchar(255) NULL;`);
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_date" timestamp(6) NULL;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedVersion` varchar(255) NULL');
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedDate` timestamp(6) NULL');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" TEXT NULL');
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_date" TEXT NULL');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
