import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class addProjectUserRole1537801450876 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE "project_user" ADD COLUMN "role" varchar(10) NOT NULL DEFAULT 'viewer' CHECK ("role" IN ('admin', 'editor', 'viewer'));
    `);
        break;
      case 'mysql':
        await queryRunner.query("ALTER TABLE `project_user` ADD `role` enum ('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer'");
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE project_user DROP COLUMN role;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `project_user` DROP COLUMN `role`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
