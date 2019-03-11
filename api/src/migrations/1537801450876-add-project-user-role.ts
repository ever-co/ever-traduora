import { MigrationInterface, QueryRunner } from 'typeorm';

export class addProjectUserRole1537801450876 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query("ALTER TABLE `project_user` ADD `role` enum ('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer'");
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `project_user` DROP COLUMN `role`');
  }
}
