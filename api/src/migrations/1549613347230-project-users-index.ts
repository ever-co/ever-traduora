import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class projectUsersIndex1549613347230 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_20543d6caa7324ce6706fad2f5" ON "project_user"("project_id", "user_id");`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('CREATE UNIQUE INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user`(`projectId`, `userId`)');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('CREATE UNIQUE INDEX "IDX_20543d6caa7324ce6706fad2f5" ON "project_user"("project_id", "user_id")');
        break;
      default:
        throw new Error(`Unsupported database type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_20543d6caa7324ce6706fad2f5" ON "project_user";`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('DROP INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('DROP INDEX IF EXISTS "IDX_20543d6caa7324ce6706fad2f5"');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
