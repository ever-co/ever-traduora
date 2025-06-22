import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class fixTranslationsPrimaryKey1542044660604 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "translation" DROP CONSTRAINT "translation_pkey"`);
        await queryRunner.query(`ALTER TABLE "translation" DROP COLUMN "id"`);
        await queryRunner.query(`ALTER TABLE "translation" ADD PRIMARY KEY ("term_id", "project_locale_id")`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `translation` DROP PRIMARY KEY');
        await queryRunner.query('ALTER TABLE `translation` DROP COLUMN `id`');
        await queryRunner.query('ALTER TABLE `translation` ADD PRIMARY KEY (`termId`, `projectLocaleId`)');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.startTransaction();
        try {
          await queryRunner.query(`CREATE TABLE "translation_new" (
            "term_id"  TEXT NOT NULL,
            "project_locale_id"  TEXT NOT NULL,
            "value" TEXT NOT NULL,
            "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
            "date_modified" TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY ("term_id", "project_locale_id")
          )`);

          await queryRunner.query(`INSERT INTO "translation_new"
            ("term_id", "project_locale_id", "value", "date_created", "date_modified")
            SELECT "term_id", "project_locale_id", "value", "date_created", "date_modified"
            FROM "translation"`);

          await queryRunner.query(`DROP TABLE "translation"`);
          await queryRunner.query(`ALTER TABLE "translation_new" RENAME TO "translation"`);

          await queryRunner.commitTransaction();
        } catch (error) {
          await queryRunner.rollbackTransaction();
          throw error;
        }
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`ALTER TABLE "translation" DROP CONSTRAINT translation_pkey`);
        await queryRunner.query(`ALTER TABLE "translation" ADD COLUMN "id" uuid DEFAULT uuid_generate_v4 (), ADD PRIMARY KEY ("id")`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `translation` DROP PRIMARY KEY');
        await queryRunner.query('ALTER TABLE `translation` ADD `id` varchar(255) NOT NULL');
        await queryRunner.query('ALTER TABLE `translation` ADD PRIMARY KEY (`id`)');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(`PRAGMA foreign_keys = OFF;`);
        await queryRunner.startTransaction();
        try {
          await queryRunner.query(`CREATE TABLE "translation_old" (
            "term_id" TEXT NOT NULL,
            "project_locale_id" TEXT NOT NULL,
            "value" TEXT NOT NULL,
            "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
            "date_modified" TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY ("term_id", "project_locale_id"),
            FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE,
            FOREIGN KEY ("project_locale_id") REFERENCES "project_locale"("id") ON DELETE CASCADE
          )`);

          await queryRunner.query(`INSERT INTO "translation_old"
            ("term_id", "project_locale_id", "value", "date_created", "date_modified")
            SELECT "term_id", "project_locale_id", "value", "date_created", "date_modified"
            FROM "translation"`);

          await queryRunner.query(`DROP TABLE "translation"`);
          await queryRunner.query(`ALTER TABLE "translation_old" RENAME TO "translation"`);

          await queryRunner.commitTransaction();
        } catch (error) {
          await queryRunner.rollbackTransaction();
          throw error;
        } finally {
          await queryRunner.query(`PRAGMA foreign_keys = ON;`);
        }
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
