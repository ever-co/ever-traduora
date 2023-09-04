import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class changeTranslationValueType1543494409127 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE translation ALTER COLUMN value SET NOT NULL;`);
        await queryRunner.query(`ALTER TABLE translation ALTER COLUMN value SET DATA TYPE text;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `translation` MODIFY COLUMN `value` text NOT NULL');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE "translation" ALTER COLUMN "value" TYPE text USING "value"::text;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `translation` MODIFY COLUMN `value` varchar(255) NOT NULL');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
