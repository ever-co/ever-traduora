import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class changeTranslationValueType1543494409127 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE translation ALTER COLUMN value SET NOT NULL;`);
        await queryRunner.query(`ALTER TABLE translation ALTER COLUMN value SET DATA TYPE text;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `translation` MODIFY COLUMN `value` text NOT NULL');
        break;
      case DbType.BETTER_SQLITE3:
        const tableInfo = await queryRunner.query(`PRAGMA table_info(translation)`);
        const hasIdColumn = tableInfo.some((col: any) => col.name === 'id');

        await queryRunner.query(`PRAGMA foreign_keys=off;`);

        await queryRunner.query(`
          CREATE TABLE translation_temp (
            ${hasIdColumn ? '"id" TEXT PRIMARY KEY NOT NULL,' : ''}
            "value" TEXT NOT NULL,
            "term_id" TEXT NOT NULL,
            "project_locale_id" TEXT NOT NULL,
            "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
            "date_modified" TEXT NOT NULL DEFAULT (datetime('now'))
            ${!hasIdColumn ? ', PRIMARY KEY ("term_id", "project_locale_id")' : ''}
          );
        `);

        if (hasIdColumn) {
          await queryRunner.query(`
            INSERT INTO translation_temp (id, value, term_id, project_locale_id, date_created, date_modified)
            SELECT id, value, term_id, project_locale_id, date_created, date_modified 
            FROM translation;
          `);
        } else {
          await queryRunner.query(`
            INSERT INTO translation_temp (value, term_id, project_locale_id, date_created, date_modified)
            SELECT value, term_id, project_locale_id, date_created, date_modified 
            FROM translation;
          `);
        }

        await queryRunner.query(`DROP TABLE translation;`);

        await queryRunner.query(`ALTER TABLE translation_temp RENAME TO translation;`);

        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_translation_term_id" ON "translation" ("term_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_translation_project_locale_id" ON "translation" ("project_locale_id")`);

        await queryRunner.query(`PRAGMA foreign_keys=on;`);
        break;
      default:
        throw new Error(`Unsupported DB type "${config.db.default.type}" in migration 1543494409127`);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "translation" ALTER COLUMN "value" TYPE varchar(255) USING "value"::varchar(255);`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `translation` MODIFY COLUMN `value` varchar(255) NOT NULL');
        break;
      case DbType.BETTER_SQLITE3:
        // No need to revert in SQLite as TEXT and VARCHAR are equivalent
        console.log('No column type change needed for SQLite down migration');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
