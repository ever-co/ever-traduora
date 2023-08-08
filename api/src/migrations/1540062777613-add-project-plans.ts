import { MigrationInterface, QueryRunner } from 'typeorm';

export class addProjectPlans1540062777613 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "plan" ("code" varchar(255) NOT NULL, "name" varchar(255) NOT NULL, "max_strings" int NOT NULL, "date_created" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), "date_modified" timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY ("code"))`
      );
    await queryRunner.query(`ALTER TABLE "project" ADD COLUMN "terms_count" INTEGER NOT NULL DEFAULT 0;`);
    await queryRunner.query(`ALTER TABLE "project" ADD COLUMN "locales_count" integer NOT NULL DEFAULT 0;`);
    await queryRunner.query(`ALTER TABLE "project" ADD COLUMN "plan_code" varchar(255) NULL;`);
    await queryRunner.query(
      `ALTER TABLE "project" ADD CONSTRAINT "FK_932b5479e9af5dc8b3c00530062" FOREIGN KEY ("plan_code") REFERENCES "plan"("code") ON DELETE SET NULL`
      );
    await queryRunner.query(`INSERT INTO "plan" ("code", "name", "max_strings") VALUES ('default', 'Default', 100);
    `);
    await queryRunner.query(`INSERT INTO plan ("code", "name", "max_strings") VALUES ('open-source', 'Open source', 100000);`);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`DELETE FROM plan WHERE code='default';`);
    await queryRunner.query(`DELETE FROM plan WHERE code='open-source';`);
    await queryRunner.query(`ALTER TABLE "project" DROP FOREIGN KEY "FK_932b5479e9af5dc8b3c00530062"`);
    await queryRunner.query(`ALTER TABLE "project" DROP COLUMN 'planCode'`);
    await queryRunner.query(`ALTER TABLE "project" DROP COLUMN 'localesCount'`);
    await queryRunner.query(`ALTER TABLE "project" DROP COLUMN 'termsCount'`);
    await queryRunner.query(`DROP TABLE IF EXISTS "plan"`);
  }
}
