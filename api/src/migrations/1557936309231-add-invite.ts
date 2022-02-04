import { MigrationInterface, QueryRunner } from 'typeorm';

export class addInvite1557936309231 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
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
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `invite` DROP FOREIGN KEY `FK_invite_project`');
    await queryRunner.query('DROP TABLE IF EXISTS `invite`');
  }
}
