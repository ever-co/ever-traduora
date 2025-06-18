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
      case DbType.POSTGRES:
        console.log('PostgreSQL uses case-sensitive collation by default, no changes needed');
        // PostgreSQL is case-sensitive by default, no action needed
        break;
      case DbType.BETTER_SQLITE3:
        console.log('SQLite uses case-sensitive collation by default, no changes needed');
        // SQLite is case-sensitive by default, no action needed
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.MYSQL:
        console.log('Reverting to case-insensitive collation for MySQL database');
        await queryRunner.query('SET FOREIGN_KEY_CHECKS=0;');
        for (const table of this.tables) {
          await queryRunner.query(`ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        }
        await queryRunner.query('SET FOREIGN_KEY_CHECKS=1;');
        break;
      case DbType.POSTGRES:
        console.log('PostgreSQL collation revert not needed');
        // No action needed for PostgreSQL
        break;
      case DbType.BETTER_SQLITE3:
        console.log('SQLite collation revert not needed');
        // No action needed for SQLite
        break;
      default:
        throw new Error(`Unknown DB type: ${config.db.default.type}`);
    }
  }
}
