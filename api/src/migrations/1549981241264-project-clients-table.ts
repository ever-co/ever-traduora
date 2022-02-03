import { MigrationInterface, QueryRunner } from 'typeorm';

export class projectClientsTable1549981241264 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      "CREATE TABLE IF NOT EXISTS `project_client` (`id` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `role` enum ('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer', `encryptedSecret` binary(60) NOT NULL, `projectId` varchar(255) NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB",
    );
    await queryRunner.query(
      'ALTER TABLE `project_client` ADD CONSTRAINT `FK_aed9d0c639a1d484d38bd3d0d74` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `project_client` DROP FOREIGN KEY `FK_aed9d0c639a1d484d38bd3d0d74`');
    await queryRunner.query('DROP TABLE IF EXISTS `project_client`');
  }
}
