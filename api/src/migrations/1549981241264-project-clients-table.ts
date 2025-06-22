import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class projectClientsTable1549981241264 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "project_client" ("id" uuid DEFAULT uuid_generate_v4 (), "name" varchar(255) NOT NULL, "role" varchar(255) NOT NULL DEFAULT 'viewer' CHECK ("role" in ('admin', 'editor', 'viewer')), "encrypted_secret" bytea NOT NULL, "project_id" uuid, "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY ("id"));`,
        );
        await queryRunner.query(
          `ALTER TABLE "project_client" ADD CONSTRAINT "FK_aed9d0c639a1d484d38bd3d0d74" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;`,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          "CREATE TABLE IF NOT EXISTS `project_client` (`id` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `role` enum ('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer', `encryptedSecret` binary(60) NOT NULL, `projectId` varchar(255) NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB",
        );
        await queryRunner.query(
          'ALTER TABLE `project_client` ADD CONSTRAINT `FK_aed9d0c639a1d484d38bd3d0d74` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('PRAGMA foreign_keys = ON');

        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "project_client" (
            "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
            "name" TEXT NOT NULL,
            "role" TEXT NOT NULL DEFAULT 'viewer' CHECK ("role" in ('admin', 'editor', 'viewer')),
            "encrypted_secret" blob NOT NULL,
            "project_id" TEXT NOT NULL,
            "date_created" datetime NOT NULL DEFAULT (datetime('now')),
            "date_modified" datetime NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
          );`,
        );
        break;
      default:
        throw new Error('Unknown DB type: ' + config.db.default.type);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE project_client DROP CONSTRAINT FK_aed9d0c639a1d484d38bd3d0d74;`);
        await queryRunner.query(`DROP TABLE IF EXISTS project_client;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `project_client` DROP FOREIGN KEY `FK_aed9d0c639a1d484d38bd3d0d74`');
        await queryRunner.query('DROP TABLE IF EXISTS `project_client`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP TABLE IF EXISTS "project_client";');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
