import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class addTosAndPrivacyFields1544283791233 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE "user" ADD "tos_and_privacy_accepted_date" timestamp NULL;`);
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" varchar(255) NULL;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedDate` timestamp(6) NULL');
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedVersion` varchar(255) NULL');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_version"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_date"; `);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedVersion`');
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedDate`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
