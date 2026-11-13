import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addTranslationHistory1794096000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "translation_history" (
            "id" uuid DEFAULT uuid_generate_v4 (),
            "term_id" uuid NOT NULL,
            "project_locale_id" uuid NOT NULL,
            "revision" integer NOT NULL,
            "previous_value" text NOT NULL,
            "value" text NOT NULL,
            "user_id" uuid DEFAULT NULL,
            "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            CONSTRAINT "PK_translation_history" PRIMARY KEY ("id")
          );`,
        );
        await queryRunner.query(
          `CREATE UNIQUE INDEX "IDX_translation_history_term_locale_revision" ON "translation_history" ("term_id", "project_locale_id", "revision");`,
        );
        await queryRunner.query(
          `ALTER TABLE "translation_history" ADD CONSTRAINT "FK_translation_history_term" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE;`,
        );
        await queryRunner.query(
          `ALTER TABLE "translation_history" ADD CONSTRAINT "FK_translation_history_locale" FOREIGN KEY ("project_locale_id") REFERENCES "project_locale"("id") ON DELETE CASCADE;`,
        );
        await queryRunner.query(
          `ALTER TABLE "translation_history" ADD CONSTRAINT "FK_translation_history_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;`,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `translation_history` (' +
            '`id` varchar(255) NOT NULL, ' +
            '`termId` varchar(255) NOT NULL, ' +
            '`projectLocaleId` varchar(255) NOT NULL, ' +
            '`revision` int NOT NULL, ' +
            '`previousValue` text NOT NULL, ' +
            '`value` text NOT NULL, ' +
            '`userId` varchar(255) NULL, ' +
            '`dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
            '`dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
            'UNIQUE INDEX `IDX_translation_history_term_locale_revision` (`termId`, `projectLocaleId`, `revision`), ' +
            'PRIMARY KEY (`id`)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'ALTER TABLE `translation_history` ADD CONSTRAINT `FK_translation_history_term` FOREIGN KEY (`termId`) REFERENCES `term`(`id`) ON DELETE CASCADE',
        );
        await queryRunner.query(
          'ALTER TABLE `translation_history` ADD CONSTRAINT `FK_translation_history_locale` FOREIGN KEY (`projectLocaleId`) REFERENCES `project_locale`(`id`) ON DELETE CASCADE',
        );
        await queryRunner.query(
          'ALTER TABLE `translation_history` ADD CONSTRAINT `FK_translation_history_user` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('PRAGMA foreign_keys = ON');

        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "translation_history" (
            "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
            "term_id" TEXT NOT NULL REFERENCES "term"("id") ON DELETE CASCADE,
            "project_locale_id" TEXT NOT NULL REFERENCES "project_locale"("id") ON DELETE CASCADE,
            "revision" INTEGER NOT NULL,
            "previous_value" TEXT NOT NULL,
            "value" TEXT NOT NULL,
            "user_id" TEXT DEFAULT NULL REFERENCES "user"("id") ON DELETE SET NULL,
            "date_created" datetime NOT NULL DEFAULT (datetime('now')),
            "date_modified" datetime NOT NULL DEFAULT (datetime('now'))
          )`,
        );
        await queryRunner.query(
          `CREATE UNIQUE INDEX "IDX_translation_history_term_locale_revision" ON "translation_history" ("term_id", "project_locale_id", "revision")`,
        );
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`DROP TABLE IF EXISTS "translation_history";`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('DROP TABLE IF EXISTS `translation_history`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP INDEX IF EXISTS "IDX_translation_history_term_locale_revision"');
        await queryRunner.query('DROP TABLE IF EXISTS "translation_history"');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
