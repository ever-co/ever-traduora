import { MigrationInterface, QueryRunner } from 'typeorm';

export class addProjectDescriptionField1543625461116 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `project` ADD `description` varchar(255) NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `project` DROP COLUMN `description`');
  }
}
