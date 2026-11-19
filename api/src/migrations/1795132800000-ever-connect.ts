import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

/**
 * Tables of the optional Ever Platform connection: the connection itself (one row, created when an operator connects),
 * the states of its installation-wide integrations and the audit trail of every change. Creates new tables only; no
 * existing table changes. Times are epoch milliseconds (`bigint`).
 */
export class everConnect1795132800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_connection" (
            "id" varchar(8) NOT NULL,
            "status" varchar(24) NOT NULL,
            "registry_instance_id" varchar(64) NULL,
            "kid" varchar(64) NULL,
            "connect_public_key" varchar(64) NULL,
            "connect_private_key_enc" text NULL,
            "connected_at" bigint NULL,
            "connected_by" varchar(64) NULL,
            "org_id" varchar(64) NULL,
            "link_id" varchar(64) NULL,
            "link_state" varchar(24) NULL,
            "display_name" varchar(120) NULL,
            "entitlements" text NULL,
            "entitlement_error" varchar(64) NULL,
            "feed_cursor" varchar(128) NULL,
            "last_heartbeat_at" bigint NULL,
            "next_heartbeat_at" bigint NULL,
            "next_entitlement_at" bigint NULL,
            "env_code_hash" varchar(64) NULL,
            "leased_by" varchar(64) NULL,
            "lease_until" bigint NULL,
            "updated_at" bigint NOT NULL,
            CONSTRAINT "PK_ever_connect_connection" PRIMARY KEY ("id")
          );`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_integration" (
            "integration_key" varchar(48) NOT NULL,
            "state" varchar(24) NOT NULL,
            "consent_id" varchar(64) NULL,
            "scope_version" integer NULL,
            "pending_remote_revoke" boolean NOT NULL DEFAULT false,
            "config" text NULL,
            "updated_at" bigint NOT NULL,
            CONSTRAINT "PK_ever_connect_integration" PRIMARY KEY ("integration_key")
          );`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_audit" (
            "id" varchar(36) NOT NULL,
            "seq" integer NOT NULL,
            "at" bigint NOT NULL,
            "action" varchar(48) NOT NULL,
            "actor_ref" varchar(64) NOT NULL,
            "detail" varchar(255) NULL,
            "prev_hash" varchar(64) NULL,
            "hash" varchar(64) NOT NULL,
            CONSTRAINT "PK_ever_connect_audit" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_ever_connect_audit_seq" UNIQUE ("seq")
          );`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ever_connect_audit_at" ON "ever_connect_audit" ("at");`);
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_connect_connection` (' +
            '`id` varchar(8) NOT NULL, ' +
            '`status` varchar(24) NOT NULL, ' +
            '`registry_instance_id` varchar(64) NULL DEFAULT NULL, ' +
            '`kid` varchar(64) NULL DEFAULT NULL, ' +
            '`connect_public_key` varchar(64) NULL DEFAULT NULL, ' +
            '`connect_private_key_enc` text NULL, ' +
            '`connected_at` bigint NULL DEFAULT NULL, ' +
            '`connected_by` varchar(64) NULL DEFAULT NULL, ' +
            '`org_id` varchar(64) NULL DEFAULT NULL, ' +
            '`link_id` varchar(64) NULL DEFAULT NULL, ' +
            '`link_state` varchar(24) NULL DEFAULT NULL, ' +
            '`display_name` varchar(120) NULL DEFAULT NULL, ' +
            '`entitlements` text NULL, ' +
            '`entitlement_error` varchar(64) NULL DEFAULT NULL, ' +
            '`feed_cursor` varchar(128) NULL DEFAULT NULL, ' +
            '`last_heartbeat_at` bigint NULL DEFAULT NULL, ' +
            '`next_heartbeat_at` bigint NULL DEFAULT NULL, ' +
            '`next_entitlement_at` bigint NULL DEFAULT NULL, ' +
            '`env_code_hash` varchar(64) NULL DEFAULT NULL, ' +
            '`leased_by` varchar(64) NULL DEFAULT NULL, ' +
            '`lease_until` bigint NULL DEFAULT NULL, ' +
            '`updated_at` bigint NOT NULL, ' +
            'PRIMARY KEY (`id`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_connect_integration` (' +
            '`integration_key` varchar(48) NOT NULL, ' +
            '`state` varchar(24) NOT NULL, ' +
            '`consent_id` varchar(64) NULL DEFAULT NULL, ' +
            '`scope_version` int NULL DEFAULT NULL, ' +
            '`pending_remote_revoke` tinyint NOT NULL DEFAULT 0, ' +
            '`config` text NULL, ' +
            '`updated_at` bigint NOT NULL, ' +
            'PRIMARY KEY (`integration_key`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_connect_audit` (' +
            '`id` varchar(36) NOT NULL, ' +
            '`seq` int NOT NULL, ' +
            '`at` bigint NOT NULL, ' +
            '`action` varchar(48) NOT NULL, ' +
            '`actor_ref` varchar(64) NOT NULL, ' +
            '`detail` varchar(255) NULL DEFAULT NULL, ' +
            '`prev_hash` varchar(64) NULL DEFAULT NULL, ' +
            '`hash` varchar(64) NOT NULL, ' +
            'PRIMARY KEY (`id`), ' +
            'UNIQUE INDEX `UQ_ever_connect_audit_seq` (`seq`), ' +
            'INDEX `IDX_ever_connect_audit_at` (`at`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_connection" (
            "id" VARCHAR(8) PRIMARY KEY NOT NULL,
            "status" VARCHAR(24) NOT NULL,
            "registry_instance_id" VARCHAR(64) DEFAULT NULL,
            "kid" VARCHAR(64) DEFAULT NULL,
            "connect_public_key" VARCHAR(64) DEFAULT NULL,
            "connect_private_key_enc" TEXT DEFAULT NULL,
            "connected_at" BIGINT DEFAULT NULL,
            "connected_by" VARCHAR(64) DEFAULT NULL,
            "org_id" VARCHAR(64) DEFAULT NULL,
            "link_id" VARCHAR(64) DEFAULT NULL,
            "link_state" VARCHAR(24) DEFAULT NULL,
            "display_name" VARCHAR(120) DEFAULT NULL,
            "entitlements" TEXT DEFAULT NULL,
            "entitlement_error" VARCHAR(64) DEFAULT NULL,
            "feed_cursor" VARCHAR(128) DEFAULT NULL,
            "last_heartbeat_at" BIGINT DEFAULT NULL,
            "next_heartbeat_at" BIGINT DEFAULT NULL,
            "next_entitlement_at" BIGINT DEFAULT NULL,
            "env_code_hash" VARCHAR(64) DEFAULT NULL,
            "leased_by" VARCHAR(64) DEFAULT NULL,
            "lease_until" BIGINT DEFAULT NULL,
            "updated_at" BIGINT NOT NULL
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_integration" (
            "integration_key" VARCHAR(48) PRIMARY KEY NOT NULL,
            "state" VARCHAR(24) NOT NULL,
            "consent_id" VARCHAR(64) DEFAULT NULL,
            "scope_version" INTEGER DEFAULT NULL,
            "pending_remote_revoke" BOOLEAN NOT NULL DEFAULT 0,
            "config" TEXT DEFAULT NULL,
            "updated_at" BIGINT NOT NULL
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_connect_audit" (
            "id" VARCHAR(36) PRIMARY KEY NOT NULL,
            "seq" INTEGER NOT NULL UNIQUE,
            "at" BIGINT NOT NULL,
            "action" VARCHAR(48) NOT NULL,
            "actor_ref" VARCHAR(64) NOT NULL,
            "detail" VARCHAR(255) DEFAULT NULL,
            "prev_hash" VARCHAR(64) DEFAULT NULL,
            "hash" VARCHAR(64) NOT NULL
          )`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ever_connect_audit_at" ON "ever_connect_audit" ("at")`);
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP INDEX IF EXISTS "IDX_ever_connect_audit_at"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_connect_audit"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_connect_integration"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_connect_connection"');
        break;
      case DbType.MYSQL:
        await queryRunner.query('DROP TABLE IF EXISTS `ever_connect_audit`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_connect_integration`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_connect_connection`');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
