import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addInviteToken1792872000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE invite ADD COLUMN token_hash VARCHAR(64) DEFAULT NULL;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `invite` ADD COLUMN `tokenHash` VARCHAR(64) DEFAULT NULL AFTER `role`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "invite" ADD COLUMN "token_hash" VARCHAR(64) DEFAULT NULL');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE invite DROP COLUMN token_hash;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `invite` DROP COLUMN `tokenHash`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "invite" DROP COLUMN "token_hash"');
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
