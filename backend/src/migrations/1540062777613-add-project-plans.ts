import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType, ColumnInfo } from '../utils/database-type-helper';

export class addProjectPlans1540062777613 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "plan" ("code" varchar(255) NOT NULL, "name" varchar(255) NOT NULL, "max_strings" int NOT NULL, "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY ("code"))`,
        );
        await queryRunner.query(`ALTER TABLE "project" ADD COLUMN "terms_count" INTEGER NOT NULL DEFAULT 0;`);
        await queryRunner.query(`ALTER TABLE "project" ADD COLUMN "locales_count" integer NOT NULL DEFAULT 0;`);
        await queryRunner.query(`ALTER TABLE "project" ADD COLUMN "plan_code" varchar(255) NULL;`);
        await queryRunner.query(
          `ALTER TABLE "project" ADD CONSTRAINT "FK_932b5479e9af5dc8b3c00530062" FOREIGN KEY ("plan_code") REFERENCES "plan"("code") ON DELETE SET NULL`,
        );
        await queryRunner.query(`INSERT INTO "plan" ("code", "name", "max_strings") VALUES ('default', 'Default', 100);
    `);
        await queryRunner.query(`INSERT INTO plan ("code", "name", "max_strings") VALUES ('open-source', 'Open source', 100000);`);
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `plan` (`code` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `maxStrings` int NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`code`)) ENGINE=InnoDB',
        );
        await queryRunner.query('ALTER TABLE `project` ADD `termsCount` int NOT NULL DEFAULT 0');
        await queryRunner.query('ALTER TABLE `project` ADD `localesCount` int NOT NULL DEFAULT 0');
        await queryRunner.query('ALTER TABLE `project` ADD `planCode` varchar(255) NULL');
        await queryRunner.query(
          'ALTER TABLE `project` ADD CONSTRAINT `FK_932b5479e9af5dc8b3c00530062` FOREIGN KEY (`planCode`) REFERENCES `plan`(`code`) ON DELETE SET NULL',
        );
        await queryRunner.query(`INSERT INTO plan (code, name, maxStrings) VALUES ('default', 'Default', 100);`);
        await queryRunner.query(`INSERT INTO plan (code, name, maxStrings) VALUES ('open-source', 'Open source', 100000);`);
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "plan" (
            "code" TEXT PRIMARY KEY NOT NULL,
            "name" TEXT NOT NULL,
            "max_strings" INTEGER NOT NULL,
            "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
            "date_modified" TEXT NOT NULL DEFAULT (datetime('now'))
          )`,
        );
        await queryRunner.query(`ALTER TABLE "project" ADD COLUMN "terms_count" INTEGER NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "project" ADD COLUMN "locales_count" INTEGER NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "project" ADD COLUMN "plan_code" TEXT`);

        await queryRunner.query(`PRAGMA foreign_keys = ON`);

        await queryRunner.query(`
          CREATE TRIGGER IF NOT EXISTS fk_project_plan_code_delete
          BEFORE DELETE ON "plan"
          FOR EACH ROW
          BEGIN
            UPDATE "project" SET "plan_code" = NULL WHERE "plan_code" = OLD.code;
          END
        `);

        await queryRunner.query(`
          CREATE TRIGGER IF NOT EXISTS fk_project_plan_code_insert
          BEFORE INSERT ON "project"
          FOR EACH ROW
          WHEN NEW.plan_code IS NOT NULL
          BEGIN
            SELECT CASE
              WHEN (SELECT code FROM "plan" WHERE code = NEW.plan_code) IS NULL
              THEN RAISE(ABORT, 'Foreign key constraint failed: plan_code must reference an existing plan')
            END;
          END
        `);

        await queryRunner.query(`
          CREATE TRIGGER IF NOT EXISTS fk_project_plan_code_update
          BEFORE UPDATE ON "project"
          FOR EACH ROW
          WHEN NEW.plan_code IS NOT NULL
          BEGIN
            SELECT CASE
              WHEN (SELECT code FROM "plan" WHERE code = NEW.plan_code) IS NULL
              THEN RAISE(ABORT, 'Foreign key constraint failed: plan_code must reference an existing plan')
            END;
          END
        `);

        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_932b5479e9af5dc8b3c0053006" ON "project" ("plan_code")`);

        await queryRunner.query(`INSERT INTO "plan" ("code", "name", "max_strings") VALUES ('default', 'Default', 100)`);
        await queryRunner.query(`INSERT INTO "plan" ("code", "name", "max_strings") VALUES ('open-source', 'Open source', 100000)`);
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`DELETE FROM plan WHERE code='default';`);
        await queryRunner.query(`DELETE FROM plan WHERE code='open-source';`);
        await queryRunner.query(`ALTER TABLE "project" DROP CONSTRAINT "FK_932b5479e9af5dc8b3c00530062"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "plan_code"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "locales_count"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "terms_count"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "plan"`);
        break;
      case DbType.MYSQL:
        await queryRunner.query(`DELETE FROM plan WHERE code = 'default';`);
        await queryRunner.query(`DELETE FROM plan WHERE code = 'open-source';`);
        await queryRunner.query('ALTER TABLE `project` DROP FOREIGN KEY `FK_932b5479e9af5dc8b3c00530062`');
        await queryRunner.query('ALTER TABLE `project` DROP COLUMN `planCode`');
        await queryRunner.query('ALTER TABLE `project` DROP COLUMN `localesCount`');
        await queryRunner.query('ALTER TABLE `project` DROP COLUMN `termsCount`');
        await queryRunner.query('DROP TABLE IF EXISTS `plan`');
        break;
      case DbType.BETTER_SQLITE3: {
        await queryRunner.query(`DELETE FROM "plan" WHERE code = 'default'`);
        await queryRunner.query(`DELETE FROM "plan" WHERE code = 'open-source'`);

        await queryRunner.query(`DROP TRIGGER IF EXISTS fk_project_plan_code_delete`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS fk_project_plan_code_insert`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS fk_project_plan_code_update`);

        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_932b5479e9af5dc8b3c0053006"`);

        const tableInfo: ColumnInfo[] = await queryRunner.query(`PRAGMA table_info("project")`);
        const hasDescription = tableInfo.some(col => col.name === 'description');

        await queryRunner.query(`PRAGMA foreign_keys=off;`);
        await queryRunner.startTransaction();
        try {
          if (hasDescription) {
            await queryRunner.query(
              `CREATE TABLE "project_tmp" (
              "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
              "name" TEXT NOT NULL,
              "description" TEXT,
              "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
              "date_modified" TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
            );

            await queryRunner.query(
              `INSERT INTO "project_tmp" ("id", "name", "description", "date_created", "date_modified")
             SELECT "id", "name", "description", "date_created", "date_modified" FROM "project"`,
            );
          } else {
            await queryRunner.query(
              `CREATE TABLE "project_tmp" (
              "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
              "name" TEXT NOT NULL,
              "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
              "date_modified" TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
            );

            await queryRunner.query(
              `INSERT INTO "project_tmp" ("id", "name", "date_created", "date_modified")
             SELECT "id", "name", "date_created", "date_modified" FROM "project"`,
            );
          }

          await queryRunner.query('DROP TABLE "project";');
          await queryRunner.query(`ALTER TABLE "project_tmp" RENAME TO "project";`);

          await queryRunner.query(`DROP TABLE IF EXISTS "plan"`);
          await queryRunner.commitTransaction();
        } catch (error) {
          await queryRunner.rollbackTransaction();
          throw error;
        } finally {
          await queryRunner.query(`PRAGMA foreign_keys = ON;`);
        }

        break;
      }
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
