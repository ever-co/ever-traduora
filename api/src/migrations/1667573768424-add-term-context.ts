import { MigrationInterface, QueryRunner } from 'typeorm';

export class addTermContext1667573768424 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE term ADD COLUMN context TEXT DEFAULT NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE term DROP COLUMN context;
    `);
  }
}
