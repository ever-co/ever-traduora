import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addTermContext1667573768424 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE term ADD COLUMN context TEXT DEFAULT NULL;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `term` ADD COLUMN `context` TEXT DEFAULT NULL AFTER `value`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "term" ADD COLUMN "context" TEXT DEFAULT NULL');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE term DROP COLUMN context;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `term` DROP COLUMN `context`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "term" DROP COLUMN "context"');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
