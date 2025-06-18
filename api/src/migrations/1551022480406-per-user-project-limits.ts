import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class perUserProjectLimits1551022480406 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "num_projects_created" integer NOT NULL DEFAULT 0;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` ADD `numProjectsCreated` int NOT NULL DEFAULT 0');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "num_projects_created" INTEGER NOT NULL DEFAULT 0');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "num_projects_created";`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `numProjectsCreated`');
        break;
      case DbType.BETTER_SQLITE3:
        // SQLite doesn't support DROP COLUMN, so we need to recreate the table
        await queryRunner.query(`PRAGMA foreign_keys=off;`);
        await queryRunner.startTransaction();
        try {
          // Create new table without the num_projects_created column
          await queryRunner.query(
            `CREATE TABLE "user_temp" (
            "id" TEXT NOT NULL DEFAULT (hex(randomblob(16))),
            "name" TEXT NOT NULL,
            "email" TEXT NOT NULL,
            "encrypted_password" BLOB NOT NULL,
            "encrypted_password_reset_token" BLOB,
            "password_reset_expires" TEXT,
            "login_attempts" INTEGER NOT NULL DEFAULT 0,
            "last_login" TEXT,
            "date_created" TEXT,
            "date_modified" TEXT,
            PRIMARY KEY ("id")
          )`,
          );

          // Copy data excluding the num_projects_created column
          await queryRunner.query(
            `INSERT INTO "user_temp" ("id", "name", "email", "encrypted_password", "encrypted_password_reset_token", "password_reset_expires", "login_attempts", "last_login", "date_created", "date_modified")
           SELECT "id", "name", "email", "encrypted_password", "encrypted_password_reset_token", "password_reset_expires", "login_attempts", "last_login", "date_created", "date_modified" FROM "user"`,
          );

          // Drop old table and rename temp table
          await queryRunner.query(`DROP TABLE "user"`);
          await queryRunner.query(`ALTER TABLE "user_temp" RENAME TO "user"`);

          await queryRunner.commitTransaction();
        } catch (error) {
          await queryRunner.rollbackTransaction();
          throw error;
        }
        await queryRunner.query(`PRAGMA foreign_keys=on;`);
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
