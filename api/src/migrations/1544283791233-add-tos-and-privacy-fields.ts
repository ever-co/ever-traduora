import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addTosAndPrivacyFields1544283791233 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" ADD "tos_and_privacy_accepted_date" timestamp NULL;`);
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" varchar(255) NULL;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedDate` timestamp(6) NULL');
        await queryRunner.query('ALTER TABLE `user` ADD `tosAndPrivacyAcceptedVersion` varchar(255) NULL');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_date" DATETIME NULL');
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" TEXT NULL');
        break;
      default:
        throw new Error('Unknown DB type: ' + config.db.default.type);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_version"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_date"; `);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedVersion`');
        await queryRunner.query('ALTER TABLE `user` DROP COLUMN `tosAndPrivacyAcceptedDate`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(`
          PRAGMA foreign_keys=off;
          
          BEGIN TRANSACTION;
          
         
          CREATE TABLE user_temp (
            "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
            "name" TEXT NOT NULL,
            "email" TEXT NOT NULL UNIQUE,
            "encrypted_password" BLOB NOT NULL,
            "encrypted_password_reset_token" BLOB NULL,
            "password_reset_expires" DATETIME NULL,
            "login_attempts" INTEGER NOT NULL DEFAULT 0,
            "last_login" DATETIME NULL,
            "date_created" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "date_modified" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          
          
          INSERT INTO user_temp 
          SELECT 
            id, name, email, encrypted_password, encrypted_password_reset_token, 
            password_reset_expires, login_attempts, last_login, 
            date_created, date_modified 
          FROM "user";
          
          
          DROP TABLE "user";
          
         
          ALTER TABLE user_temp RENAME TO "user";
          
          
          CREATE TRIGGER IF NOT EXISTS user_delete
           BEFORE DELETE ON "user"
           FOR EACH ROW
           BEGIN
             DELETE FROM "project_user" WHERE "user_id" = OLD."id";
           END;
          
          COMMIT;
          
          PRAGMA foreign_keys=on;
        `);
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
