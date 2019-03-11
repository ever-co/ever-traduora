import { MigrationInterface, QueryRunner } from 'typeorm';

export class fixTranslationsPrimaryKey1542044660604 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `translation` DROP PRIMARY KEY');
    await queryRunner.query('ALTER TABLE `translation` DROP COLUMN `id`');
    await queryRunner.query('ALTER TABLE `translation` ADD PRIMARY KEY (`termId`, `projectLocaleId`)');
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `translation` DROP PRIMARY KEY');
    await queryRunner.query('ALTER TABLE `translation` ADD `id` varchar(255) NOT NULL');
    await queryRunner.query('ALTER TABLE `translation` ADD PRIMARY KEY (`id`)');
  }
}
