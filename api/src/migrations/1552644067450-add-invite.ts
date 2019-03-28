import { MigrationInterface, QueryRunner } from "typeorm";

export class addInvite1552644067450 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
      await queryRunner.query(
        "CREATE TABLE `invite` ( \
          `id` varchar(255) NOT NULL, \
          `email` varchar(255) NOT NULL, \
          `status` enum ('sent', 'accepted') NOT NULL DEFAULT 'sent', \
          `role` enum ('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer', \
          `projectId` varchar(255) NULL, \
          `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \
          `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \
          PRIMARY KEY (`id`) \
        ) ENGINE=InnoDB"
      );
      await queryRunner.query('ALTER TABLE `invite` ADD CONSTRAINT `FK_invite_project` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE');
      await queryRunner.query('CREATE UNIQUE INDEX `IDX_email_project` ON `invite`(`projectId`, `email`)');
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
      await queryRunner.query('ALTER TABLE `invite` DROP FOREIGN KEY `FK_invite_project`');
      await queryRunner.query('DROP INDEX `IDX_email_project` ON `invite`');
      await queryRunner.query('DROP TABLE `invite`');
    }
}