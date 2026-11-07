import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

/**
 * Tables of the optional anonymous usage statistics: the installation's anonymous identity (`ever_instance`), the last
 * reports (`ever_stats_report`), the sending lease (`ever_stats_lease`) and the shared schedule
 * (`ever_stats_schedule`), plus an index on `translation`'s modification time for the monthly count. Creates new
 * tables and one index only; no existing table or column changes. Every statement is idempotent.
 */
export class everPlatform1793000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_instance" (
            "id" character varying(8) NOT NULL,
            "instance_id" character varying(36) NOT NULL,
            "stats_public_key" text NOT NULL,
            "stats_private_key_enc" text NOT NULL,
            "stats_key_id" character varying(16) NOT NULL,
            "stats_enabled_ui" boolean NOT NULL DEFAULT true,
            "stats_enabled_changed_at" TIMESTAMP(6),
            "stats_enabled_changed_by" character varying(36),
            "created_at" TIMESTAMP(6) NOT NULL DEFAULT now(),
            "reset_count" integer NOT NULL DEFAULT '0',
            CONSTRAINT "PK_ever_instance" PRIMARY KEY ("id")
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_report" (
            "id" character varying(36) NOT NULL,
            "instance_id" character varying(36) NOT NULL,
            "period" character varying(7) NOT NULL,
            "final" boolean NOT NULL DEFAULT false,
            "payload" text NOT NULL,
            "signature" text NOT NULL,
            "sent_at" TIMESTAMP(6),
            "http_status" integer,
            "status" character varying(16) NOT NULL,
            "attempts" integer NOT NULL DEFAULT '0',
            "next_attempt_at" TIMESTAMP(6),
            "error" character varying(128),
            "hint" character varying(32),
            "created_at" TIMESTAMP(6) NOT NULL DEFAULT now(),
            CONSTRAINT "PK_ever_stats_report" PRIMARY KEY ("id")
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_lease" (
            "owner" character varying(16) NOT NULL,
            "leased_by" character varying(128),
            "lease_until" TIMESTAMP(6),
            CONSTRAINT "PK_ever_stats_lease" PRIMARY KEY ("owner")
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_schedule" (
            "id" character varying(16) NOT NULL,
            "next_send_at" TIMESTAMP(6),
            "last_sent_at" TIMESTAMP(6),
            "last_attempt_at" TIMESTAMP(6),
            "last_status" character varying(16),
            "last_final_sent_for" character varying(7),
            "retry_attempt" integer NOT NULL DEFAULT '0',
            "blocked_module_version" character varying(16),
            "last_manual_send_at" TIMESTAMP(6),
            CONSTRAINT "PK_ever_stats_schedule" PRIMARY KEY ("id")
          )`,
        );
        await queryRunner.query(`INSERT INTO "ever_stats_lease" ("owner") VALUES ('stats') ON CONFLICT DO NOTHING`);
        await queryRunner.query(`INSERT INTO "ever_stats_schedule" ("id") VALUES ('stats') ON CONFLICT DO NOTHING`);
        await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_translation_modified" ON "translation" ("date_modified")');
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_instance` (' +
            '`id` varchar(8) NOT NULL, ' +
            '`instance_id` varchar(36) NOT NULL, ' +
            '`stats_public_key` text NOT NULL, ' +
            '`stats_private_key_enc` text NOT NULL, ' +
            '`stats_key_id` varchar(16) NOT NULL, ' +
            '`stats_enabled_ui` tinyint NOT NULL DEFAULT 1, ' +
            '`stats_enabled_changed_at` timestamp(6) NULL, ' +
            '`stats_enabled_changed_by` varchar(36) NULL, ' +
            '`created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
            "`reset_count` int NOT NULL DEFAULT '0', " +
            'PRIMARY KEY (`id`)' +
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_stats_report` (' +
            '`id` varchar(36) NOT NULL, ' +
            '`instance_id` varchar(36) NOT NULL, ' +
            '`period` varchar(7) NOT NULL, ' +
            '`final` tinyint NOT NULL DEFAULT 0, ' +
            '`payload` text NOT NULL, ' +
            '`signature` text NOT NULL, ' +
            '`sent_at` timestamp(6) NULL, ' +
            '`http_status` int NULL, ' +
            '`status` varchar(16) NOT NULL, ' +
            "`attempts` int NOT NULL DEFAULT '0', " +
            '`next_attempt_at` timestamp(6) NULL, ' +
            '`error` varchar(128) NULL, ' +
            '`hint` varchar(32) NULL, ' +
            '`created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
            'PRIMARY KEY (`id`)' +
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_stats_lease` (' +
            '`owner` varchar(16) NOT NULL, ' +
            '`leased_by` varchar(128) NULL, ' +
            '`lease_until` timestamp(6) NULL, ' +
            'PRIMARY KEY (`owner`)' +
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_stats_schedule` (' +
            '`id` varchar(16) NOT NULL, ' +
            '`next_send_at` timestamp(6) NULL, ' +
            '`last_sent_at` timestamp(6) NULL, ' +
            '`last_attempt_at` timestamp(6) NULL, ' +
            '`last_status` varchar(16) NULL, ' +
            '`last_final_sent_for` varchar(7) NULL, ' +
            "`retry_attempt` int NOT NULL DEFAULT '0', " +
            '`blocked_module_version` varchar(16) NULL, ' +
            '`last_manual_send_at` timestamp(6) NULL, ' +
            'PRIMARY KEY (`id`)' +
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
        await queryRunner.query("INSERT IGNORE INTO `ever_stats_lease` (`owner`) VALUES ('stats')");
        await queryRunner.query("INSERT IGNORE INTO `ever_stats_schedule` (`id`) VALUES ('stats')");
        // MySQL 5.7 has no CREATE INDEX IF NOT EXISTS; the camelCase column is the one of DefaultNamingStrategy
        if (!(await this.hasMysqlTranslationIndex(queryRunner))) {
          await queryRunner.query('CREATE INDEX `idx_translation_modified` ON `translation` (`dateModified`)');
        }
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_instance" (
            "id" varchar(8) PRIMARY KEY NOT NULL,
            "instance_id" varchar(36) NOT NULL,
            "stats_public_key" text NOT NULL,
            "stats_private_key_enc" text NOT NULL,
            "stats_key_id" varchar(16) NOT NULL,
            "stats_enabled_ui" boolean NOT NULL DEFAULT (1),
            "stats_enabled_changed_at" datetime,
            "stats_enabled_changed_by" varchar(36),
            "created_at" datetime NOT NULL DEFAULT (datetime('now')),
            "reset_count" integer NOT NULL DEFAULT (0)
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_report" (
            "id" varchar(36) PRIMARY KEY NOT NULL,
            "instance_id" varchar(36) NOT NULL,
            "period" varchar(7) NOT NULL,
            "final" boolean NOT NULL DEFAULT (0),
            "payload" text NOT NULL,
            "signature" text NOT NULL,
            "sent_at" datetime,
            "http_status" integer,
            "status" varchar(16) NOT NULL,
            "attempts" integer NOT NULL DEFAULT (0),
            "next_attempt_at" datetime,
            "error" varchar(128),
            "hint" varchar(32),
            "created_at" datetime NOT NULL DEFAULT (datetime('now'))
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_lease" (
            "owner" varchar(16) PRIMARY KEY NOT NULL,
            "leased_by" varchar(128),
            "lease_until" datetime
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_schedule" (
            "id" varchar(16) PRIMARY KEY NOT NULL,
            "next_send_at" datetime,
            "last_sent_at" datetime,
            "last_attempt_at" datetime,
            "last_status" varchar(16),
            "last_final_sent_for" varchar(7),
            "retry_attempt" integer NOT NULL DEFAULT (0),
            "blocked_module_version" varchar(16),
            "last_manual_send_at" datetime
          )`,
        );
        await queryRunner.query(`INSERT OR IGNORE INTO "ever_stats_lease" ("owner") VALUES ('stats')`);
        await queryRunner.query(`INSERT OR IGNORE INTO "ever_stats_schedule" ("id") VALUES ('stats')`);
        await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_translation_modified" ON "translation" ("date_modified")');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query('DROP INDEX IF EXISTS "idx_translation_modified"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_schedule"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_lease"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_report"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_instance"');
        break;
      case DbType.MYSQL:
        if (await this.hasMysqlTranslationIndex(queryRunner)) {
          await queryRunner.query('DROP INDEX `idx_translation_modified` ON `translation`');
        }
        await queryRunner.query('DROP TABLE IF EXISTS `ever_stats_schedule`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_stats_lease`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_stats_report`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_instance`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP INDEX IF EXISTS "idx_translation_modified"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_schedule"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_lease"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_report"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_instance"');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  private async hasMysqlTranslationIndex(queryRunner: QueryRunner): Promise<boolean> {
    const rows = await queryRunner.query(
      'SELECT COUNT(*) AS `count` FROM information_schema.statistics ' +
        "WHERE table_schema = DATABASE() AND table_name = 'translation' AND index_name = 'idx_translation_modified'",
    );
    return Number(rows?.[0]?.count ?? 0) > 0;
  }
}
