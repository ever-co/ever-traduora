import { MigrationInterface, QueryRunner } from 'typeorm';

export class changeTranslationValueType1543494409127 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `translation` MODIFY COLUMN `value` text NOT NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `translation` MODIFY COLUMN `value` varchar(255) NOT NULL');
  }
}
