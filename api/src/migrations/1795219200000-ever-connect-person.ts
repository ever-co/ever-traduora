import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

/**
 * Tables of a person's requests through the optional Ever Platform connection: the person links this installation
 * reported, the receipts of deletion and export requests, and the exports waiting to be downloaded. Creates new tables
 * only; no existing table changes. Times are epoch milliseconds (`bigint`).
 */
export class everConnectPerson1795219200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_person_link" (
            "user_identity_id" varchar(36) NOT NULL,
            "user_id" varchar(36) NOT NULL,
            "reported_at" bigint NULL,
            "updated_at" bigint NOT NULL,
            CONSTRAINT "PK_ever_connect_person_link" PRIMARY KEY ("user_identity_id")
          );`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_person_request" (
            "job_id" varchar(64) NOT NULL,
            "kind" varchar(16) NOT NULL,
            "result" varchar(24) NULL,
            "reason_code" varchar(64) NULL,
            "accounts" integer NOT NULL DEFAULT 0,
            "received_at" bigint NOT NULL,
            "answered_at" bigint NULL,
            CONSTRAINT "PK_ever_connect_person_request" PRIMARY KEY ("job_id")
          );`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_person_export" (
            "job_id" varchar(64) NOT NULL,
            "user_id" varchar(36) NOT NULL,
            "bundle_enc" text NOT NULL,
            "created_at" bigint NOT NULL,
            "expires_at" bigint NOT NULL,
            CONSTRAINT "PK_ever_connect_person_export" PRIMARY KEY ("job_id", "user_id")
          );`,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_connect_person_link` (' +
            '`user_identity_id` varchar(36) NOT NULL, ' +
            '`user_id` varchar(36) NOT NULL, ' +
            '`reported_at` bigint NULL DEFAULT NULL, ' +
            '`updated_at` bigint NOT NULL, ' +
            'PRIMARY KEY (`user_identity_id`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_connect_person_request` (' +
            '`job_id` varchar(64) NOT NULL, ' +
            '`kind` varchar(16) NOT NULL, ' +
            '`result` varchar(24) NULL DEFAULT NULL, ' +
            '`reason_code` varchar(64) NULL DEFAULT NULL, ' +
            '`accounts` int NOT NULL DEFAULT 0, ' +
            '`received_at` bigint NOT NULL, ' +
            '`answered_at` bigint NULL DEFAULT NULL, ' +
            'PRIMARY KEY (`job_id`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_connect_person_export` (' +
            '`job_id` varchar(64) NOT NULL, ' +
            '`user_id` varchar(36) NOT NULL, ' +
            '`bundle_enc` mediumtext NOT NULL, ' +
            '`created_at` bigint NOT NULL, ' +
            '`expires_at` bigint NOT NULL, ' +
            'PRIMARY KEY (`job_id`, `user_id`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_person_link" (
            "user_identity_id" VARCHAR(36) PRIMARY KEY NOT NULL,
            "user_id" VARCHAR(36) NOT NULL,
            "reported_at" BIGINT DEFAULT NULL,
            "updated_at" BIGINT NOT NULL
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_person_request" (
            "job_id" VARCHAR(64) PRIMARY KEY NOT NULL,
            "kind" VARCHAR(16) NOT NULL,
            "result" VARCHAR(24) DEFAULT NULL,
            "reason_code" VARCHAR(64) DEFAULT NULL,
            "accounts" INTEGER NOT NULL DEFAULT 0,
            "received_at" BIGINT NOT NULL,
            "answered_at" BIGINT DEFAULT NULL
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_person_export" (
            "job_id" VARCHAR(64) NOT NULL,
            "user_id" VARCHAR(36) NOT NULL,
            "bundle_enc" TEXT NOT NULL,
            "created_at" BIGINT NOT NULL,
            "expires_at" BIGINT NOT NULL,
            PRIMARY KEY ("job_id", "user_id")
          )`,
        );
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP TABLE IF EXISTS "ever_connect_person_export"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_connect_person_request"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_connect_person_link"');
        break;
      case DbType.MYSQL:
        await queryRunner.query('DROP TABLE IF EXISTS `ever_connect_person_export`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_connect_person_request`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_connect_person_link`');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
