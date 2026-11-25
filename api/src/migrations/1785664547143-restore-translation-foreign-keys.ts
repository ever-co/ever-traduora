import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class RestoreTranslationForeignKeys1785664547143 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
      case DbType.MYSQL:
        // The foreign keys from the initial migration are still in place.
        break;
      case DbType.BETTER_SQLITE3:
        // The table rebuilds in migrations 1542044660604 and 1543494409127
        // recreated "translation" without the foreign keys declared in the
        // initial migration, so deleting a term or a project locale stopped
        // cascading and left orphaned translation rows behind (#492).
        //
        // "label_translations_translation" references "translation" with ON
        // DELETE CASCADE, and PRAGMA foreign_keys cannot change inside a
        // transaction, so dropping the table below may cascade and clear the
        // label associations. They are backed up first and restored at the
        // end, which keeps the rebuild correct whether or not foreign key
        // enforcement is active while the migration runs.
        await this.rebuildTranslationTable(queryRunner, true);
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
      case DbType.MYSQL:
        break;
      case DbType.BETTER_SQLITE3:
        await this.rebuildTranslationTable(queryRunner, false);
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  private async rebuildTranslationTable(queryRunner: QueryRunner, withForeignKeys: boolean): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "label_translations_backup" AS
       SELECT "label_id", "translation_term_id", "translation_project_locale_id" FROM "label_translations_translation"`,
    );

    const foreignKeys = withForeignKeys
      ? `,
            FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE,
            FOREIGN KEY ("project_locale_id") REFERENCES "project_locale"("id") ON DELETE CASCADE`
      : '';

    await queryRunner.query(
      `CREATE TABLE "translation_temp" (
            "term_id" TEXT NOT NULL,
            "project_locale_id" TEXT NOT NULL,
            "value" TEXT NOT NULL,
            "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
            "date_modified" TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY ("term_id", "project_locale_id")${foreignKeys}
          )`,
    );

    // Copying only the rows whose term and project locale still exist drops
    // the orphans accumulated while the foreign keys were missing.
    await queryRunner.query(
      `INSERT INTO "translation_temp" ("term_id", "project_locale_id", "value", "date_created", "date_modified")
       SELECT "term_id", "project_locale_id", "value", "date_created", "date_modified"
       FROM "translation"
       WHERE "term_id" IN (SELECT "id" FROM "term")
         AND "project_locale_id" IN (SELECT "id" FROM "project_locale")`,
    );

    await queryRunner.query(`DROP TABLE "translation"`);
    await queryRunner.query(`ALTER TABLE "translation_temp" RENAME TO "translation"`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_translation_term_id" ON "translation" ("term_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_translation_project_locale_id" ON "translation" ("project_locale_id")`);

    // Restore the label associations for the translations that survived the
    // rebuild. INSERT OR IGNORE covers the case where the drop above did not
    // cascade and the association rows are still present.
    await queryRunner.query(
      `INSERT OR IGNORE INTO "label_translations_translation" ("label_id", "translation_term_id", "translation_project_locale_id")
       SELECT "label_id", "translation_term_id", "translation_project_locale_id"
       FROM "label_translations_backup"
       WHERE ("translation_term_id", "translation_project_locale_id") IN
         (SELECT "term_id", "project_locale_id" FROM "translation")`,
    );

    // If the drop did not cascade, associations pointing at purged orphan
    // translations are still around and must go too.
    await queryRunner.query(
      `DELETE FROM "label_translations_translation"
       WHERE ("translation_term_id", "translation_project_locale_id") NOT IN
         (SELECT "term_id", "project_locale_id" FROM "translation")`,
    );

    await queryRunner.query(`DROP TABLE "label_translations_backup"`);
  }
}
