import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addTermContext1667573768424 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE term ADD COLUMN context TEXT DEFAULT NULL;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `term` ADD COLUMN `context` TEXT DEFAULT NULL AFTER `value`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "term" ADD COLUMN "context" TEXT DEFAULT NULL');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE term DROP COLUMN context;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `term` DROP COLUMN `context`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(`PRAGMA foreign_keys=off;`);

        await queryRunner.query(
          `CREATE TABLE "term_temp" (
            "id" TEXT NOT NULL DEFAULT (hex(randomblob(16))),
            "value" TEXT NOT NULL,
            "project_id" TEXT,
            "date_created" TEXT,
            "date_modified" TEXT,
            PRIMARY KEY ("id"),
            FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
          )`,
        );

        await queryRunner.query(
          `INSERT INTO "term_temp" ("id", "value", "project_id", "date_created", "date_modified")
           SELECT "id", "value", "project_id", "date_created", "date_modified" FROM "term"`,
        );

        // Drop old table and rename temp table
        await queryRunner.query(`DROP TABLE "term"`);
        await queryRunner.query(`ALTER TABLE "term_temp" RENAME TO "term"`);

        await queryRunner.query(`PRAGMA foreign_keys=on;`);
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
