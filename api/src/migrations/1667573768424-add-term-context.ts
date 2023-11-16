import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class addTermContext1667573768424 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE term ADD COLUMN context TEXT DEFAULT NULL;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `term` ADD COLUMN `context` TEXT DEFAULT NULL AFTER `value`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE term DROP COLUMN context;
    `);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `term` DROP COLUMN `context`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
