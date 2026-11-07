import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

/**
 * Tables of the optional OpenID Connect sign-in (e.g. Ever ID): the identities attached to accounts, the sessions
 * opened with them (revocable by a back-channel logout) and the ids of logout tokens already processed. Creates new
 * tables only; no existing table changes.
 */
export class everId1794009600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "user_identity" (
            "id" uuid DEFAULT uuid_generate_v4 (),
            "user_id" uuid NOT NULL,
            "provider" varchar(32) NOT NULL,
            "issuer" varchar(255) NOT NULL,
            "subject" varchar(255) NOT NULL,
            "ever_person_id" varchar(64) NULL,
            "email_at_link" varchar(255) NOT NULL,
            "link_method" varchar(16) NOT NULL,
            "linked_at" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            "last_login_at" timestamp(6) NULL,
            CONSTRAINT "PK_user_identity" PRIMARY KEY ("id"),
            CONSTRAINT "IDX_user_identity_issuer_subject" UNIQUE ("issuer", "subject"),
            CONSTRAINT "FK_user_identity_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
          );`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_identity_user_id" ON "user_identity" ("user_id");`);
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_id_session" (
            "sid" varchar(255) NOT NULL,
            "user_id" varchar(255) NOT NULL,
            "jti" varchar(64) NOT NULL,
            "issued_at" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            "expires_at" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            "revoked_at" timestamp(6) NULL,
            CONSTRAINT "PK_ever_id_session" PRIMARY KEY ("sid")
          );`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ever_id_session_user_id" ON "ever_id_session" ("user_id");`);
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_id_logout_jti" (
            "jti" varchar(255) NOT NULL,
            "expires_at" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            CONSTRAINT "PK_ever_id_logout_jti" PRIMARY KEY ("jti")
          );`,
        );
        break;
      case DbType.MYSQL:
        // Same character set and collation as `user` (utf8mb4_bin), which the foreign key requires
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `user_identity` (' +
            '`id` varchar(255) NOT NULL, ' +
            '`userId` varchar(255) NOT NULL, ' +
            '`provider` varchar(32) NOT NULL, ' +
            '`issuer` varchar(255) NOT NULL, ' +
            '`subject` varchar(255) NOT NULL, ' +
            '`everPersonId` varchar(64) NULL DEFAULT NULL, ' +
            '`emailAtLink` varchar(255) NOT NULL, ' +
            '`linkMethod` varchar(16) NOT NULL, ' +
            '`linkedAt` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
            '`lastLoginAt` timestamp(6) NULL DEFAULT NULL, ' +
            'PRIMARY KEY (`id`), ' +
            'UNIQUE INDEX `IDX_user_identity_issuer_subject` (`issuer`, `subject`), ' +
            'INDEX `IDX_user_identity_user_id` (`userId`), ' +
            'CONSTRAINT `FK_user_identity_user` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_id_session` (' +
            '`sid` varchar(255) NOT NULL, ' +
            '`userId` varchar(255) NOT NULL, ' +
            '`jti` varchar(64) NOT NULL, ' +
            '`issuedAt` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
            '`expiresAt` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
            '`revokedAt` timestamp(6) NULL DEFAULT NULL, ' +
            'PRIMARY KEY (`sid`), ' +
            'INDEX `IDX_ever_id_session_user_id` (`userId`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `ever_id_logout_jti` (' +
            '`jti` varchar(255) NOT NULL, ' +
            '`expiresAt` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
            'PRIMARY KEY (`jti`)' +
            ') ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "user_identity" (
            "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
            "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
            "provider" VARCHAR(32) NOT NULL,
            "issuer" VARCHAR(255) NOT NULL,
            "subject" VARCHAR(255) NOT NULL,
            "ever_person_id" VARCHAR(64) DEFAULT NULL,
            "email_at_link" VARCHAR(255) NOT NULL,
            "link_method" VARCHAR(16) NOT NULL,
            "linked_at" DATETIME NOT NULL DEFAULT (datetime('now')),
            "last_login_at" DATETIME DEFAULT NULL,
            CONSTRAINT "IDX_user_identity_issuer_subject" UNIQUE ("issuer", "subject")
          )`,
        );
        await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_user_identity_user_id" ON "user_identity" ("user_id")');
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_id_session" (
            "sid" VARCHAR(255) PRIMARY KEY NOT NULL,
            "user_id" VARCHAR(255) NOT NULL,
            "jti" VARCHAR(64) NOT NULL,
            "issued_at" DATETIME NOT NULL DEFAULT (datetime('now')),
            "expires_at" DATETIME NOT NULL DEFAULT (datetime('now')),
            "revoked_at" DATETIME DEFAULT NULL
          )`,
        );
        await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_ever_id_session_user_id" ON "ever_id_session" ("user_id")');
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "ever_id_logout_jti" (
            "jti" VARCHAR(255) PRIMARY KEY NOT NULL,
            "expires_at" DATETIME NOT NULL DEFAULT (datetime('now'))
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
        await queryRunner.query('DROP TABLE IF EXISTS "ever_id_logout_jti"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_id_session"');
        await queryRunner.query('DROP TABLE IF EXISTS "user_identity"');
        break;
      case DbType.MYSQL:
        await queryRunner.query('DROP TABLE IF EXISTS `ever_id_logout_jti`');
        await queryRunner.query('DROP TABLE IF EXISTS `ever_id_session`');
        await queryRunner.query('DROP TABLE IF EXISTS `user_identity`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP INDEX IF EXISTS "IDX_ever_id_session_user_id"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_id_logout_jti"');
        await queryRunner.query('DROP TABLE IF EXISTS "ever_id_session"');
        await queryRunner.query('DROP INDEX IF EXISTS "IDX_user_identity_user_id"');
        await queryRunner.query('DROP TABLE IF EXISTS "user_identity"');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
