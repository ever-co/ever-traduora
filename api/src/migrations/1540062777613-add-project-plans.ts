import { MigrationInterface, QueryRunner } from 'typeorm';

import { config } from '../config';

export class addProjectPlans1540062777613 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
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
      case 'mysql':
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
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`DELETE FROM plan WHERE code='default';`);
        await queryRunner.query(`DELETE FROM plan WHERE code='open-source';`);
        await queryRunner.query(`ALTER TABLE "project" DROP FOREIGN KEY "FK_932b5479e9af5dc8b3c00530062"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN 'planCode'`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN 'localesCount'`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN 'termsCount'`);
        await queryRunner.query(`DROP TABLE IF EXISTS "plan"`);
        break;
      case 'mysql':
        await queryRunner.query(`DELETE FROM plan WHERE code = 'default';`);
        await queryRunner.query(`DELETE FROM plan WHERE code = 'open-source';`);
        await queryRunner.query('ALTER TABLE `project` DROP FOREIGN KEY `FK_932b5479e9af5dc8b3c00530062`');
        await queryRunner.query('ALTER TABLE `project` DROP COLUMN `planCode`');
        await queryRunner.query('ALTER TABLE `project` DROP COLUMN `localesCount`');
        await queryRunner.query('ALTER TABLE `project` DROP COLUMN `termsCount`');
        await queryRunner.query('DROP TABLE IF EXISTS `plan`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
