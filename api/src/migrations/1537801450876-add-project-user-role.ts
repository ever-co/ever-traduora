import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addProjectUserRole1537801450876 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `ALTER TABLE "project_user" ADD COLUMN "role" varchar(10) NOT NULL DEFAULT 'viewer' CHECK ("role" IN ('admin', 'editor', 'viewer'))`,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query("ALTER TABLE `project_user` ADD `role` enum ('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer'");
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(`ALTER TABLE "project_user" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'viewer'`);
        await queryRunner.query(`CREATE TABLE "project_user_temp" AS SELECT * FROM "project_user"`);
        await queryRunner.query(`DROP TABLE "project_user"`);
        await queryRunner.query(
          `CREATE TABLE "project_user" (
            "id" TEXT NOT NULL DEFAULT (hex(randomblob(16))),
            "project_id" TEXT,
            "user_id" TEXT,
            "role" TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','editor','viewer')),
            "date_created" TEXT,
            "date_modified" TEXT,
            PRIMARY KEY ("id"),
            FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE,
            FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
          )`,
        );

        await queryRunner.query(`INSERT INTO "project_user" SELECT * FROM "project_user_temp"`);
        await queryRunner.query(`DROP TABLE "project_user_temp"`);

        break;
      default:
        throw new Error('Unknown DB type: ' + config.db.default.type);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE project_user DROP COLUMN role`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `project_user` DROP COLUMN `role`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "project_user" DROP COLUMN "role"');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
