import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class removeTosAndPrivacy1552494719664 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_date";`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_version";`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedDate`');
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedVersion`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(`PRAGMA foreign_keys=off;`);
        await queryRunner.startTransaction();
        try {
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
            "num_projects_created" INTEGER NOT NULL DEFAULT 0,
            "date_created" TEXT,
            "date_modified" TEXT,
            PRIMARY KEY ("id")
          )`,
          );

          await queryRunner.query(
            `INSERT INTO "user_temp" ("id", "name", "email", "encrypted_password", "encrypted_password_reset_token", "password_reset_expires", "login_attempts", "last_login", "num_projects_created", "date_created", "date_modified")
           SELECT "id", "name", "email", "encrypted_password", "encrypted_password_reset_token", "password_reset_expires", "login_attempts", "last_login", "num_projects_created", "date_created", "date_modified" FROM "user"`,
          );

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

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" varchar(255) NULL;`);
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_date" timestamp(6) NULL;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedVersion` varchar(255) NULL');
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedDate` timestamp(6) NULL');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" TEXT NULL');
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_date" TEXT NULL');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
