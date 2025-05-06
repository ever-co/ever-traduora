import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addLabel1575719158140 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "label" (
        "id" uuid DEFAULT uuid_generate_v4 (),
        "value" varchar(255) NOT NULL,
        "color" varchar(7) NOT NULL,
        "project_id" uuid DEFAULT uuid_generate_v4 (),
        PRIMARY KEY ("id"),
        CONSTRAINT "label_project_fk" FOREIGN KEY ("project_id")
            REFERENCES "project" ("id") ON DELETE CASCADE,
        CONSTRAINT "label_project_terms_uq"
            UNIQUE ("project_id", "value")
    );
    `,
        );
        await queryRunner.query(
          `ALTER TABLE "label" ADD CONSTRAINT "FK_project"
      FOREIGN KEY ("project_id")
      REFERENCES "project" ("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION;`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_171dadf4b0b751badd68de0bd3"
    ON "label" ("project_id", "value");`);
        await queryRunner.query(
          `ALTER TABLE "label" ADD CONSTRAINT "FK_5ed9c8937635b255539d31b2cce"
      FOREIGN KEY ("project_id")
      REFERENCES "project" ("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION;
  `,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `label` (`id` varchar(255) NOT NULL, `value` varchar(255) NOT NULL, `color` varchar(7) NOT NULL, `projectId` varchar(255) NOT NULL, UNIQUE INDEX `IDX_project_terms` (`projectId`, `value`), PRIMARY KEY (`id`)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'ALTER TABLE `label` ADD CONSTRAINT `FK_project` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
        );
        await queryRunner.query('CREATE UNIQUE INDEX `IDX_171dadf4b0b751badd68de0bd3` ON `label` (`projectId`, `value`)');
        await queryRunner.query(
          'ALTER TABLE `label` ADD CONSTRAINT `FK_5ed9c8937635b255539d31b2cce` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(`PRAGMA foreign_keys = ON;`);
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "label" (
            "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
            "value" TEXT NOT NULL,
            "color" TEXT NOT NULL CHECK(length("color") = 7),
            "project_id" TEXT NOT NULL,
            UNIQUE ("project_id", "value"),
            FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
          )`,
        );
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "label" DROP FOREIGN KEY "FK_5ed9c8937635b255539d31b2cce"`);
        await queryRunner.query(`DROP INDEX "IDX_171dadf4b0b751badd68de0bd3" ON "label"`);
        await queryRunner.query(`ALTER TABLE "label" DROP FOREIGN KEY "FK_project"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "label"`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `label` DROP FOREIGN KEY `FK_5ed9c8937635b255539d31b2cce`');
        await queryRunner.query('DROP INDEX `IDX_171dadf4b0b751badd68de0bd3` ON `label`');
        await queryRunner.query('ALTER TABLE `label` DROP FOREIGN KEY `FK_project`');
        await queryRunner.query('DROP TABLE IF EXISTS `label`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP TABLE IF EXISTS "label"');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
