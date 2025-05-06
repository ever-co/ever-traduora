import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class init1537535282567 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "project" ("id" uuid DEFAULT uuid_generate_v4 (), "name" varchar(255) NOT NULL, "date_created" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, "date_modified" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("id"));`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS project_locale (
        "id" uuid DEFAULT uuid_generate_v4 (),
        "locale_code" varchar(255) NULL,
        "project_id" uuid DEFAULT uuid_nil (),
        "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        CONSTRAINT "project_locale_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "project_locale_unique_project_id_locale_code" UNIQUE ("project_id", "locale_code")
  );
  `,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "user" ("id" uuid DEFAULT uuid_generate_v4 (),"name" varchar(255) NOT NULL,"email" varchar(255) NOT NULL,"encrypted_password" bytea NOT NULL,"encrypted_password_reset_token" bytea NULL,"password_reset_expires" timestamp(6) NULL,"login_attempts" int NOT NULL DEFAULT 0,"last_login" timestamp(6) NULL,"date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),"date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),CONSTRAINT "user_email_unique" UNIQUE ("email"),CONSTRAINT "user_pkey" PRIMARY KEY ("id")
  );`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "project_user" ("id" uuid DEFAULT uuid_generate_v4 (),"project_id" uuid NULL,"user_id" uuid NULL,"date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),"date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),PRIMARY KEY ("id")
  );`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "term" ("id" uuid DEFAULT uuid_generate_v4 (),"value" varchar(255) NOT NULL,"project_id" uuid NOT NULL,"date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),"date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),CONSTRAINT "unique_project_value" UNIQUE ("project_id", "value"),CONSTRAINT "pk_term" PRIMARY KEY ("id")
  )`,
        );
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "translation" ("id" uuid DEFAULT uuid_generate_v4 (), "value" varchar(255) NOT NULL, "term_id" uuid NOT NULL, "project_locale_id" uuid DEFAULT uuid_generate_v4 (), "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),  CONSTRAINT "translation_pkey" PRIMARY KEY ("id"));
  `,
        );
        await queryRunner.query(
          `ALTER TABLE "project_locale" ADD CONSTRAINT "FK_a2a11dc444732d36e2b3f08fe4b" FOREIGN KEY ("locale_code") REFERENCES locale("code") ON DELETE CASCADE;
  `,
        );
        await queryRunner.query(
          `ALTER TABLE "project_locale" ADD CONSTRAINT "FK_3adfd3457f80d19efe53c8e5754" FOREIGN KEY ("project_id") REFERENCES project("id") ON DELETE CASCADE;`,
        );
        await queryRunner.query(
          `ALTER TABLE "project_user" ADD CONSTRAINT "FK_be4e7ad73afd703f94b8866eb6b" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;`,
        );
        await queryRunner.query(
          `ALTER TABLE "project_user" ADD CONSTRAINT "FK_8d75193a81f827ba8d58575e637" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE`,
        );
        await queryRunner.query(
          `ALTER TABLE "term" ADD CONSTRAINT "FK_b541fb8d0122efed5c870d55b15" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;`,
        );
        await queryRunner.query(
          `ALTER TABLE "translation" ADD CONSTRAINT "FK_f7f6e4a8de56880547c414276be" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE;`,
        );
        await queryRunner.query(
          `ALTER TABLE "translation" ADD CONSTRAINT "FK_52b10ad0b87f2f52ed24b7dc451" FOREIGN KEY ("project_locale_id") REFERENCES "project_locale"("id") ON DELETE CASCADE;`,
        );
        break;
      case DbType.MYSQL:
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `project` (`id` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `project_locale` (`id` varchar(255) NOT NULL, `localeCode` varchar(255) NULL, `projectId` varchar(255) NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_2eaddab6fd95ae7425fc346db1` (`projectId`, `localeCode`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `user` (`id` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `email` varchar(255) NOT NULL, `encryptedPassword` binary(60) NOT NULL, `encryptedPasswordResetToken` blob NULL, `passwordResetExpires` timestamp(6) NULL, `loginAttempts` int NOT NULL DEFAULT 0, `lastLogin` timestamp(6) NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_e12875dfb3b1d92d7d7c5377e2` (`email`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `project_user` (`id` varchar(255) NOT NULL, `projectId` varchar(255) NULL, `userId` varchar(255) NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `term` (`id` varchar(255) NOT NULL, `value` varchar(255) NOT NULL, `projectId` varchar(255) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_5f4321d5b62e77d1c7004e7b74` (`projectId`, `value`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
          'CREATE TABLE IF NOT EXISTS `translation` (`id` varchar(255) NOT NULL, `value` varchar(255) NOT NULL, `termId` varchar(255) NOT NULL, `projectLocaleId` varchar(255) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
          'ALTER TABLE `project_locale` ADD CONSTRAINT `FK_a2a11dc444732d36e2b3f08fe4b` FOREIGN KEY (`localeCode`) REFERENCES `locale`(`code`) ON DELETE CASCADE',
        );
        await queryRunner.query(
          'ALTER TABLE `project_locale` ADD CONSTRAINT `FK_3adfd3457f80d19efe53c8e5754` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
        );
        await queryRunner.query(
          'ALTER TABLE `project_user` ADD CONSTRAINT `FK_be4e7ad73afd703f94b8866eb6b` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
        );
        await queryRunner.query(
          'ALTER TABLE `project_user` ADD CONSTRAINT `FK_8d75193a81f827ba8d58575e637` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE',
        );
        await queryRunner.query(
          'ALTER TABLE `term` ADD CONSTRAINT `FK_b541fb8d0122efed5c870d55b15` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
        );
        await queryRunner.query(
          'ALTER TABLE `translation` ADD CONSTRAINT `FK_f7f6e4a8de56880547c414276be` FOREIGN KEY (`termId`) REFERENCES `term`(`id`) ON DELETE CASCADE',
        );
        await queryRunner.query(
          'ALTER TABLE `translation` ADD CONSTRAINT `FK_52b10ad0b87f2f52ed24b7dc451` FOREIGN KEY (`projectLocaleId`) REFERENCES `project_locale`(`id`) ON DELETE CASCADE',
        );
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "project" (
            "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
              "name" TEXT NOT NULL,
              "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
              "date_modified" TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
        );

        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "project_locale" (
             "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
              "locale_code" TEXT,
              "project_id" TEXT,
              "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
              "date_modified" TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE ("project_id", "locale_code"),
              FOREIGN KEY ("locale_code") REFERENCES "locale"("code") ON DELETE CASCADE,
              FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
            )`,
        );

        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "user" (
              "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
              "name" TEXT NOT NULL,
              "email" TEXT NOT NULL UNIQUE,
              "encrypted_password" BLOB NOT NULL,
              "encrypted_password_reset_token" BLOB,
              "password_reset_expires" TEXT,
              "login_attempts" INTEGER NOT NULL DEFAULT 0,
              "last_login" TEXT,
              "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
              "date_modified" TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
        );

        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "project_user" (
              "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
              "project_id" TEXT,
              "user_id" TEXT,
              "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
              "date_modified" TEXT NOT NULL DEFAULT (datetime('now')),
              FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE,
              FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
            )`,
        );

        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "term" (
              "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
              "value" TEXT NOT NULL,
              "project_id" TEXT NOT NULL,
              "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
              "date_modified" TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE ("project_id", "value"),
              FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
            )`,
        );

        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "translation" (
              "id" TEXT PRIMARY KEY NOT NULL DEFAULT (hex(randomblob(16))),
              "value" TEXT NOT NULL,
              "term_id" TEXT NOT NULL,
              "project_locale_id" TEXT NOT NULL,
              "date_created" TEXT NOT NULL DEFAULT (datetime('now')),
              "date_modified" TEXT NOT NULL DEFAULT (datetime('now')),
              FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE,
              FOREIGN KEY ("project_locale_id") REFERENCES "project_locale"("id") ON DELETE CASCADE
            )`,
        );

        await queryRunner.query(`CREATE INDEX "IDX_translation_term_id" ON "translation" ("term_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_translation_project_locale_id" ON "translation" ("project_locale_id")`);
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "translation" DROP FOREIGN KEY "FK_52b10ad0b87f2f52ed24b7dc451"`);
        await queryRunner.query(`ALTER TABLE "translation" DROP FOREIGN KEY "FK_f7f6e4a8de56880547c414276be"`);
        await queryRunner.query(`ALTER TABLE "term" DROP FOREIGN KEY "FK_b541fb8d0122efed5c870d55b15"`);
        await queryRunner.query(`ALTER TABLE "project_user" DROP FOREIGN KEY "FK_8d75193a81f827ba8d58575e637"`);
        await queryRunner.query(`ALTER TABLE "project_user" DROP FOREIGN KEY "FK_be4e7ad73afd703f94b8866eb6b"`);
        await queryRunner.query(`ALTER TABLE "project_locale" DROP FOREIGN KEY "FK_3adfd3457f80d19efe53c8e5754"`);
        await queryRunner.query(`ALTER TABLE "project_locale" DROP FOREIGN KEY "FK_a2a11dc444732d36e2b3f08fe4b"`);
        await queryRunner.query(`DROP INDEX "IDX_fd325cc6295e7207a8d8ec7e83" ON "translation"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "translation"`);
        await queryRunner.query(`DROP INDEX "IDX_5f4321d5b62e77d1c7004e7b74" ON "term"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "term"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "project_user"`);
        await queryRunner.query(`DROP INDEX "IDX_e12875dfb3b1d92d7d7c5377e2" ON "user"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "user"`);
        await queryRunner.query(`DROP INDEX "IDX_2eaddab6fd95ae7425fc346db1" ON "project_locale"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "project_locale"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "project"`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_52b10ad0b87f2f52ed24b7dc451`');
        await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_f7f6e4a8de56880547c414276be`');
        await queryRunner.query('ALTER TABLE `term` DROP FOREIGN KEY `FK_b541fb8d0122efed5c870d55b15`');
        await queryRunner.query('ALTER TABLE `project_user` DROP FOREIGN KEY `FK_8d75193a81f827ba8d58575e637`');
        await queryRunner.query('ALTER TABLE `project_user` DROP FOREIGN KEY `FK_be4e7ad73afd703f94b8866eb6b`');
        await queryRunner.query('ALTER TABLE `project_locale` DROP FOREIGN KEY `FK_3adfd3457f80d19efe53c8e5754`');
        await queryRunner.query('ALTER TABLE `project_locale` DROP FOREIGN KEY `FK_a2a11dc444732d36e2b3f08fe4b`');
        await queryRunner.query('DROP INDEX `IDX_fd325cc6295e7207a8d8ec7e83` ON `translation`');
        await queryRunner.query('DROP TABLE IF EXISTS `translation`');
        await queryRunner.query('DROP INDEX `IDX_5f4321d5b62e77d1c7004e7b74` ON `term`');
        await queryRunner.query('DROP TABLE IF EXISTS `term`');
        await queryRunner.query('DROP TABLE IF EXISTS `project_user`');
        await queryRunner.query('DROP INDEX `IDX_e12875dfb3b1d92d7d7c5377e2` ON `user`');
        await queryRunner.query('DROP TABLE IF EXISTS `user`');
        await queryRunner.query('DROP INDEX `IDX_2eaddab6fd95ae7425fc346db1` ON `project_locale`');
        await queryRunner.query('DROP TABLE IF EXISTS `project_locale`');
        await queryRunner.query('DROP TABLE IF EXISTS `project`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP INDEX IF EXISTS "IDX_translation_project_locale_id"');
        await queryRunner.query('DROP INDEX IF EXISTS "IDX_translation_term_id"');
        await queryRunner.query('DROP TABLE IF EXISTS "translation"');
        await queryRunner.query('DROP TABLE IF EXISTS "term"');
        await queryRunner.query('DROP TABLE IF EXISTS "project_user"');
        await queryRunner.query('DROP TABLE IF EXISTS "user"');
        await queryRunner.query('DROP TABLE IF EXISTS "project_locale"');
        await queryRunner.query('DROP TABLE IF EXISTS "project"');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
