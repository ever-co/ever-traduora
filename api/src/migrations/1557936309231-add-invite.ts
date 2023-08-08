import { MigrationInterface, QueryRunner } from 'typeorm';

export class addInvite1557936309231 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
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
      `
    );
    await queryRunner.query(
      `ALTER TABLE "invite" ADD CONSTRAINT "FK_invite_project" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;
      `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "invite" DROP CONSTRAINT "FK_invite_project";
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "invite"`);
  }
}
