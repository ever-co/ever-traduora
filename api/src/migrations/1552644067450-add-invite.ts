import { MigrationInterface, QueryRunner } from "typeorm";

export class addInvite1552644067450 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
      await queryRunner.query(
        "CREATE TABLE `invite` ( \
          `id` varchar(255) NOT NULL, \
          `email` varchar(255) NOT NULL, \
          `status` enum ('sent', 'accepted', 'declined') NOT NULL DEFAULT 'sent', \
          `role` enum ('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer', \
          `projectId` varchar(255) NULL, \
          `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \
          `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \
          PRIMARY KEY (`id`) \
        ) ENGINE=InnoDB"
      );
      // await queryRunner.query(
      //   ''
      // );
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query('DROP TABLE `invite`');
        // await queryRunner.query('');
    }
}