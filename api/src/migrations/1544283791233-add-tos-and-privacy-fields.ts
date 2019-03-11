import { MigrationInterface, QueryRunner } from 'typeorm';

export class addTosAndPrivacyFields1544283791233 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedDate` timestamp(6) NULL');
    await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedVersion` varchar(255) NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedVersion`');
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedDate`');
  }
}
