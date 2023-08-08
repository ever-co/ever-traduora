import { MigrationInterface, QueryRunner } from 'typeorm';

export class addLabelJoinTables1575734358119 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "label_terms_term" (
        "label_id" uuid DEFAULT uuid_generate_v4 (),
        "term_id" uuid DEFAULT uuid_generate_v4 (),
        PRIMARY KEY ("label_id", "term_id")
    );`
    );

    await queryRunner.query(
      `
      CREATE TABLE IF NOT EXISTS "label_translations_translation" (
        "label_id" uuid DEFAULT uuid_generate_v4 (),
        "translation_term_id" uuid DEFAULT uuid_generate_v4 (),
        "translation_project_locale_id" uuid DEFAULT uuid_generate_v4 (),
        CONSTRAINT "PK_9ec857c974a19b54c1e0cb03f91"
            PRIMARY KEY ("label_id", "translation_term_id", "translation_project_locale_id")
    );
    `
    );

    await queryRunner.query(
      `
      CREATE INDEX "IDX_957f3fe5cf7454257be8643575"
    ON "label_translations_translation" ("label_id");
    `
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_e23da620cb42782a14167e9dbe"
      ON "label_translations_translation" ("translation_term_id", "translation_project_locale_id");
    `
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_fe6fef74dbcdde7bf8727ea4b9" ON "label_terms_term" ("label_id");`
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_f7ce5f99c00bdc74dd42809b6d" ON "label_terms_term" ("term_id");
      `
    );

    await queryRunner.query(
      `ALTER TABLE "label_terms_term" ADD CONSTRAINT "FK_fe6fef74dbcdde7bf8727ea4b96" FOREIGN KEY ("label_id") REFERENCES "label"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      `
    );

    await queryRunner.query(
      `ALTER TABLE "label_terms_term" ADD CONSTRAINT "FK_f7ce5f99c00bdc74dd42809b6dc" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      `
    );

    await queryRunner.query(
      `ALTER TABLE "label_translations_translation" ADD CONSTRAINT "FK_957f3fe5cf7454257be8643575c" FOREIGN KEY ("label_id") REFERENCES "label"("id") ON DELETE CASCADE ON UPDATE NO ACTION;`
    );

    await queryRunner.query(
      `ALTER TABLE "label_translations_translation" ADD CONSTRAINT "FK_e23da620cb42782a14167e9dbe7" FOREIGN KEY ("translation_term_id", "translation_project_locale_id") REFERENCES "translation"("term_id","project_locale_id") ON DELETE CASCADE ON UPDATE NO ACTION;`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "label_translations_translation" DROP FOREIGN KEY "FK_e23da620cb42782a14167e9dbe7"`);
    await queryRunner.query(`ALTER TABLE "label_translations_translation" DROP FOREIGN KEY "FK_957f3fe5cf7454257be8643575c"`);
    await queryRunner.query(`ALTER TABLE "label_terms_term" DROP FOREIGN KEY "FK_f7ce5f99c00bdc74dd42809b6dc"`);
    await queryRunner.query(`ALTER TABLE "label_terms_term" DROP FOREIGN KEY "FK_fe6fef74dbcdde7bf8727ea4b96"`);
    await queryRunner.query(`DROP INDEX "IDX_e23da620cb42782a14167e9dbe" ON "label_translations_translation"`);
    await queryRunner.query(`DROP INDEX "IDX_957f3fe5cf7454257be8643575" ON "label_translations_translation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "label_translations_translation"`);
    await queryRunner.query(`DROP INDEX "IDX_f7ce5f99c00bdc74dd42809b6d" ON "label_terms_term"`);
    await queryRunner.query(`DROP INDEX "IDX_fe6fef74dbcdde7bf8727ea4b9" ON "label_terms_term"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "label_terms_term"`);
  }
}
