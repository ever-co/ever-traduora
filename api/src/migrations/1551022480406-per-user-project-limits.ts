import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class perUserProjectLimits1551022480406 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "num_projects_created" integer NOT NULL DEFAULT 0;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `user` ADD `numProjectsCreated` int NOT NULL DEFAULT 0');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "num_projects_created";`);
  }
}
