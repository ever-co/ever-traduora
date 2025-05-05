import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class fixCaseInsensitiveCollation1575658419248 implements MigrationInterface {
  tables = ['migrations', 'project_locale', 'translation', 'project_client', 'term', 'project_user', 'plan', 'project', 'user', 'locale', 'invite'];

  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.MYSQL:
        await queryRunner.query('SET FOREIGN_KEY_CHECKS=0;');
        for (const table of this.tables) {
          await queryRunner.query(`ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;`);
        }
        await queryRunner.query('SET FOREIGN_KEY_CHECKS=1;');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'mysql':
        await queryRunner.query('SET FOREIGN_KEY_CHECKS=0;');
        for (const table of this.tables) {
          await queryRunner.query(`ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        }
        await queryRunner.query('SET FOREIGN_KEY_CHECKS=1;');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
