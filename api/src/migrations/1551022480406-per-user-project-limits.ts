import { MigrationInterface, QueryRunner } from 'typeorm';

export class perUserProjectLimits1551022480406 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `user` ADD `numProjectsCreated` int NOT NULL DEFAULT 0');
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `numProjectsCreated`');
  }
}
