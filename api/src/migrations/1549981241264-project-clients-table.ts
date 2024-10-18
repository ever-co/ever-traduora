import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class projectClientsTable1549981241264 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(
          `CREATE TABLE IF NOT EXISTS "project_client" ("id" uuid DEFAULT uuid_generate_v4 (), "name" varchar(255) NOT NULL, "role" varchar(255) NOT NULL DEFAULT 'viewer' CHECK ("role" in ('admin', 'editor', 'viewer')), "encrypted_secret" bytea NOT NULL, "project_id" uuid DEFAULT uuid_generate_v4 (), "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY ("id"));`,
        );
        await queryRunner.query(
          `ALTER TABLE "project_client" ADD CONSTRAINT "FK_aed9d0c639a1d484d38bd3d0d74" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;`,
        );
        break;
      case 'mysql':
        await queryRunner.query(
          "CREATE TABLE IF NOT EXISTS `project_client` (`id` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `role` enum ('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer', `encryptedSecret` binary(60) NOT NULL, `projectId` varchar(255) NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB",
        );
        await queryRunner.query(
          'ALTER TABLE `project_client` ADD CONSTRAINT `FK_aed9d0c639a1d484d38bd3d0d74` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
        );
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE project_client DROP CONSTRAINT FK_aed9d0c639a1d484d38bd3d0d74;`);
        await queryRunner.query(`DROP TABLE IF EXISTS project_client;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `project_client` DROP FOREIGN KEY `FK_aed9d0c639a1d484d38bd3d0d74`');
        await queryRunner.query('DROP TABLE IF EXISTS `project_client`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
