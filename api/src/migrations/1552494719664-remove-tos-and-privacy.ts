import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class removeTosAndPrivacy1552494719664 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_date";`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_version";`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedDate`');
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedVersion`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" varchar(255) NULL;`);
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_date" timestamp(6) NULL;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedVersion` varchar(255) NULL');
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedDate` timestamp(6) NULL');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
