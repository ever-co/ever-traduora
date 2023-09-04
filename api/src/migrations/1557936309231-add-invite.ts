import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class addInvite1557936309231 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "invite" (
        "id" uuid DEFAULT uuid_generate_v4 (),
        "email" varchar(255) NOT NULL,
        "status" varchar(255) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted')),
        "role" varchar(255) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
        "project_id" uuid DEFAULT uuid_generate_v4 (),
        "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        CONSTRAINT "PK_invite" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_email_project" UNIQUE ("project_id", "email")
      ) WITH (OIDS=FALSE);
      `,
        );
        await queryRunner.query(
          `ALTER TABLE "invite" ADD CONSTRAINT "FK_invite_project" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;
      `,
        );
        break;
      case 'mysql':
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
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE "invite" DROP CONSTRAINT "FK_invite_project";
    `);
        await queryRunner.query(`DROP TABLE IF EXISTS "invite"`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `invite` DROP FOREIGN KEY `FK_invite_project`');
        await queryRunner.query('DROP TABLE IF EXISTS `invite`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
