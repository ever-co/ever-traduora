import { MigrationInterface, QueryRunner } from 'typeorm';

export class fixTranslationsPrimaryKey1542044660604 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "translation" DROP CONSTRAINT "translation_pkey";
    `);
    await queryRunner.query(`ALTER TABLE "translation" DROP COLUMN "id";`);
    await queryRunner.query(`ALTER TABLE "translation" ADD PRIMARY KEY ("term_id", "project_locale_id");`);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE translation DROP CONSTRAINT translation_pkey;`);
    await queryRunner.query(`ALTER TABLE translation ADD id SERIAL PRIMARY KEY;
    `);
    await queryRunner.query(`ALTER TABLE "translation" ADD COLUMN "id" varchar(255) NOT NULL PRIMARY KEY;`);
  }
}
