import { MigrationInterface, QueryRunner } from 'typeorm';

export class projectClientsTable1549981241264 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_client" ("id" uuid DEFAULT uuid_generate_v4 (), "name" varchar(255) NOT NULL, "role" varchar(255) NOT NULL DEFAULT 'viewer' CHECK ("role" in ('admin', 'editor', 'viewer')), "encrypted_secret" bytea NOT NULL, "project_id" uuid DEFAULT uuid_generate_v4 (), "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY ("id"));`
    );
    await queryRunner.query(
      `ALTER TABLE "project_client" ADD CONSTRAINT "FK_aed9d0c639a1d484d38bd3d0d74" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE project_client DROP CONSTRAINT FK_aed9d0c639a1d484d38bd3d0d74;`);
    await queryRunner.query(`DROP TABLE IF EXISTS project_client;`);
  }
}
