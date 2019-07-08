import { MigrationInterface, QueryRunner } from 'typeorm';

export class providerGoogle1562578811334 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `project` CHANGE `description` `description` varchar(255) NULL');
    await queryRunner.query('ALTER TABLE `user` CHANGE `encryptedPassword` `encryptedPassword` binary(60) NULL');
    await queryRunner.query('ALTER TABLE `translation` DROP COLUMN `value`');
    await queryRunner.query('ALTER TABLE `translation` ADD `value` text NOT NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `translation` DROP COLUMN `value`');
    await queryRunner.query('ALTER TABLE `translation` ADD `value` mediumtext CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL');
    await queryRunner.query('ALTER TABLE `user` CHANGE `encryptedPassword` `encryptedPassword` binary(60) NOT NULL');
    await queryRunner.query(
      'ALTER TABLE `project` CHANGE `description` `description` varchar(255) CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NULL',
    );
  }
}
