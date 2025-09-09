import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addInvite1557936309231 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "invite" (
            "id" uuid DEFAULT uuid_generate_v4 (),
            "email" varchar(255) NOT NULL,
            "status" varchar(255) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted')),
            "role" varchar(255) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
            "project_id" uuid NOT NULL,
            "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            CONSTRAINT "PK_invite" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_email_project" UNIQUE ("project_id", "email")
          ) WITH (OIDS=FALSE);`,
        );
        await queryRunner.query(
          `ALTER TABLE "invite" ADD CONSTRAINT "FK_invite_project" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;`,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          "CREATE TABLE IF NOT EXISTS `invite` ( \
            `id` varchar(255) NOT NULL, \
            `email` varchar(255) NOT NULL, \
            `status` enum ('sent', 'accepted') NOT NULL DEFAULT 'sent', \
            `role` enum ('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer', \
            `projectId` varchar(255) NOT NULL, \
            `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \
            `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \
            PRIMARY KEY (`id`), \
            UNIQUE INDEX `IDX_email_project` (`projectId`, `email`) \
          ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
        );
        await queryRunner.query(
          'ALTER TABLE `invite` ADD CONSTRAINT `FK_invite_project` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('PRAGMA foreign_keys = ON');

        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "invite" (
            "id"  TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
            "email" TEXT NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'sent' CHECK ("status" IN ('sent', 'accepted')),
            "role" TEXT NOT NULL DEFAULT 'viewer' CHECK ("role" IN ('admin', 'editor', 'viewer')),
            "project_id" TEXT NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
            "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
            "date_modified" TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE ("project_id", "email")
          )`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_invite_project_id" ON "invite" ("project_id")`);
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "invite" DROP CONSTRAINT "FK_invite_project"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "invite"`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `invite` DROP FOREIGN KEY `FK_invite_project`');
        await queryRunner.query('DROP TABLE IF EXISTS `invite`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP INDEX IF EXISTS "IDX_invite_project_id"');
        await queryRunner.query('DROP TABLE IF EXISTS "invite"');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
