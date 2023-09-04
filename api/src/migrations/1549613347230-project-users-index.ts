import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class projectUsersIndex1549613347230 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_20543d6caa7324ce6706fad2f5" ON "project_user"("project_id", "user_id");`);
        break;
      case 'mysql':
        await queryRunner.query('CREATE UNIQUE INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user`(`projectId`, `userId`)');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_20543d6caa7324ce6706fad2f5" ON "project_user";`);
        break;
      case 'mysql':
        await queryRunner.query('DROP INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
