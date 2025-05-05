import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class perUserProjectLimits1551022480406 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "num_projects_created" integer NOT NULL DEFAULT 0;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` ADD `numProjectsCreated` int NOT NULL DEFAULT 0');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "num_projects_created" INTEGER NOT NULL DEFAULT 0');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "num_projects_created";`);
  }
}
