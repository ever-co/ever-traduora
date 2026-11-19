import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

const TRANSLATION_MODIFIED_INDEX = 'IDX_translation_date_modified';

/**
 * Tables of the optional anonymous usage statistics: the anonymous identity of the installation, the last reports and
 * the shared schedule (seeded with its single row), plus an index on `translation`'s modification date that the monthly
 * count of changed translations reads. Creates new tables and one index only; no existing column changes. Times are
 * epoch milliseconds (`bigint`), so every database compares them the same way.
 */
export class everPlatform1795046400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_instance" (
            "id" varchar(8) NOT NULL,
            "instance_id" varchar(36) NOT NULL,
            "stats_public_key" varchar(64) NOT NULL,
            "stats_private_key_enc" text NOT NULL,
            "stats_key_id" varchar(16) NOT NULL,
            "stats_enabled_ui" boolean NOT NULL DEFAULT true,
            "stats_enabled_changed_at" bigint NULL,
            "stats_enabled_changed_by" varchar(36) NULL,
            "created_at" bigint NOT NULL,
            "reset_count" integer NOT NULL DEFAULT 0,
            "reset_at" bigint NULL,
            CONSTRAINT "PK_ever_instance" PRIMARY KEY ("id")
          );`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_report" (
            "report_id" varchar(64) NOT NULL,
            "period" varchar(7) NOT NULL,
            "final" boolean NOT NULL DEFAULT false,
            "payload" text NOT NULL,
            "signature" varchar(128) NOT NULL DEFAULT '',
            "created_at" bigint NOT NULL,
            "sent_at" bigint NULL,
            "http_status" integer NULL,
            "status" varchar(16) NOT NULL,
            "attempts" integer NOT NULL DEFAULT 0,
            "retry" varchar(16) NOT NULL DEFAULT 'none',
            "error" varchar(160) NULL,
            "hint" varchar(32) NULL,
            CONSTRAINT "PK_ever_stats_report" PRIMARY KEY ("report_id")
          );`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_schedule" (
            "id" varchar(16) NOT NULL,
            "leased_by" varchar(64) NULL,
            "lease_until" bigint NULL,
            "first_boot_at" bigint NULL,
            "next_send_at" bigint NULL,
            "last_sent_at" bigint NULL,
            "last_attempt_at" bigint NULL,
            "last_status" varchar(16) NULL,
            "last_final_sent_for" varchar(7) NULL,
            "retry_attempt" integer NOT NULL DEFAULT 0,
            "blocked_module_version" varchar(16) NULL,
            "last_manual_send_at" bigint NULL,
            CONSTRAINT "PK_ever_stats_schedule" PRIMARY KEY ("id")
          );`,
        );
        await queryRunner.query(`INSERT INTO "ever_stats_schedule" ("id") VALUES ('stats') ON CONFLICT DO NOTHING;`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "${TRANSLATION_MODIFIED_INDEX}" ON "translation" ("date_modified");`);
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_instance` (' +
            '`id` varchar(8) NOT NULL, ' +
            '`instance_id` varchar(36) NOT NULL, ' +
            '`stats_public_key` varchar(64) NOT NULL, ' +
            '`stats_private_key_enc` text NOT NULL, ' +
            '`stats_key_id` varchar(16) NOT NULL, ' +
            '`stats_enabled_ui` tinyint NOT NULL DEFAULT 1, ' +
            '`stats_enabled_changed_at` bigint NULL DEFAULT NULL, ' +
            '`stats_enabled_changed_by` varchar(36) NULL DEFAULT NULL, ' +
            '`created_at` bigint NOT NULL, ' +
            '`reset_count` int NOT NULL DEFAULT 0, ' +
            '`reset_at` bigint NULL DEFAULT NULL, ' +
            'PRIMARY KEY (`id`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_stats_report` (' +
            '`report_id` varchar(64) NOT NULL, ' +
            '`period` varchar(7) NOT NULL, ' +
            '`final` tinyint NOT NULL DEFAULT 0, ' +
            '`payload` text NOT NULL, ' +
            "`signature` varchar(128) NOT NULL DEFAULT '', " +
            '`created_at` bigint NOT NULL, ' +
            '`sent_at` bigint NULL DEFAULT NULL, ' +
            '`http_status` int NULL DEFAULT NULL, ' +
            '`status` varchar(16) NOT NULL, ' +
            '`attempts` int NOT NULL DEFAULT 0, ' +
            "`retry` varchar(16) NOT NULL DEFAULT 'none', " +
            '`error` varchar(160) NULL DEFAULT NULL, ' +
            '`hint` varchar(32) NULL DEFAULT NULL, ' +
            'PRIMARY KEY (`report_id`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_stats_schedule` (' +
            '`id` varchar(16) NOT NULL, ' +
            '`leased_by` varchar(64) NULL DEFAULT NULL, ' +
            '`lease_until` bigint NULL DEFAULT NULL, ' +
            '`first_boot_at` bigint NULL DEFAULT NULL, ' +
            '`next_send_at` bigint NULL DEFAULT NULL, ' +
            '`last_sent_at` bigint NULL DEFAULT NULL, ' +
            '`last_attempt_at` bigint NULL DEFAULT NULL, ' +
            '`last_status` varchar(16) NULL DEFAULT NULL, ' +
            '`last_final_sent_for` varchar(7) NULL DEFAULT NULL, ' +
            '`retry_attempt` int NOT NULL DEFAULT 0, ' +
            '`blocked_module_version` varchar(16) NULL DEFAULT NULL, ' +
            '`last_manual_send_at` bigint NULL DEFAULT NULL, ' +
            'PRIMARY KEY (`id`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query("INSERT IGNORE INTO `ever_stats_schedule` (`id`) VALUES ('stats')");
        // MySQL 5.7 has no CREATE INDEX IF NOT EXISTS
        if (!(await this.mysqlIndexExists(queryRunner))) {
          await queryRunner.query(`CREATE INDEX \`${TRANSLATION_MODIFIED_INDEX}\` ON \`translation\` (\`dateModified\`)`);
        }
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_instance" (
            "id" VARCHAR(8) PRIMARY KEY NOT NULL,
            "instance_id" VARCHAR(36) NOT NULL,
            "stats_public_key" VARCHAR(64) NOT NULL,
            "stats_private_key_enc" TEXT NOT NULL,
            "stats_key_id" VARCHAR(16) NOT NULL,
            "stats_enabled_ui" BOOLEAN NOT NULL DEFAULT 1,
            "stats_enabled_changed_at" BIGINT DEFAULT NULL,
            "stats_enabled_changed_by" VARCHAR(36) DEFAULT NULL,
            "created_at" BIGINT NOT NULL,
            "reset_count" INTEGER NOT NULL DEFAULT 0,
            "reset_at" BIGINT DEFAULT NULL
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_report" (
            "report_id" VARCHAR(64) PRIMARY KEY NOT NULL,
            "period" VARCHAR(7) NOT NULL,
            "final" BOOLEAN NOT NULL DEFAULT 0,
            "payload" TEXT NOT NULL,
            "signature" VARCHAR(128) NOT NULL DEFAULT '',
            "created_at" BIGINT NOT NULL,
            "sent_at" BIGINT DEFAULT NULL,
            "http_status" INTEGER DEFAULT NULL,
            "status" VARCHAR(16) NOT NULL,
            "attempts" INTEGER NOT NULL DEFAULT 0,
            "retry" VARCHAR(16) NOT NULL DEFAULT 'none',
            "error" VARCHAR(160) DEFAULT NULL,
            "hint" VARCHAR(32) DEFAULT NULL
          )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_stats_schedule" (
            "id" VARCHAR(16) PRIMARY KEY NOT NULL,
            "leased_by" VARCHAR(64) DEFAULT NULL,
            "lease_until" BIGINT DEFAULT NULL,
            "first_boot_at" BIGINT DEFAULT NULL,
            "next_send_at" BIGINT DEFAULT NULL,
            "last_sent_at" BIGINT DEFAULT NULL,
            "last_attempt_at" BIGINT DEFAULT NULL,
            "last_status" VARCHAR(16) DEFAULT NULL,
            "last_final_sent_for" VARCHAR(7) DEFAULT NULL,
            "retry_attempt" INTEGER NOT NULL DEFAULT 0,
            "blocked_module_version" VARCHAR(16) DEFAULT NULL,
            "last_manual_send_at" BIGINT DEFAULT NULL
          )`,
        );
        await queryRunner.query(`INSERT OR IGNORE INTO "ever_stats_schedule" ("id") VALUES ('stats')`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "${TRANSLATION_MODIFIED_INDEX}" ON "translation" ("date_modified")`);
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`DROP INDEX IF EXISTS "${TRANSLATION_MODIFIED_INDEX}"`);
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_schedule"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_report"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_instance"');
        break;
      case DbType.MYSQL:
        if (await this.mysqlIndexExists(queryRunner)) {
          await queryRunner.query(`DROP INDEX \`${TRANSLATION_MODIFIED_INDEX}\` ON \`translation\``);
        }
        await queryRunner.query('DROP TABLE IF EXISTS `ever_stats_schedule`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_stats_report`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_instance`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(`DROP INDEX IF EXISTS "${TRANSLATION_MODIFIED_INDEX}"`);
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_schedule"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_stats_report"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_instance"');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  private async mysqlIndexExists(queryRunner: QueryRunner): Promise<boolean> {
    const rows = await queryRunner.query(
      'SELECT COUNT(*) AS `n` FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
      ['translation', TRANSLATION_MODIFIED_INDEX],
    );
    return Number(rows?.[0]?.n ?? 0) > 0;
  }
}
