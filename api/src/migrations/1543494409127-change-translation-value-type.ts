import { MigrationInterface, QueryRunner } from "typeorm";

export class changeTranslationValueType1543494409127 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE translation ALTER COLUMN value SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE translation ALTER COLUMN value SET DATA TYPE text;`);
  }
  

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "translation" ALTER COLUMN "value" TYPE text USING "value"::text;`);
  }
}
