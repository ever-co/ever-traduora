import { MigrationInterface, QueryRunner } from 'typeorm';

export class addProjectUserRole1537801450876 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "project_user" ADD COLUMN "role" varchar(10) NOT NULL DEFAULT 'viewer' CHECK ("role" IN ('admin', 'editor', 'viewer'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE project_user DROP COLUMN role;`);
  }
}
