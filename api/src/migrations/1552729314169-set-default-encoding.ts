import { MigrationInterface, QueryRunner } from 'typeorm';
import { DbType } from '../utils/database-type-helper';

export class setDefaultEncoding1552729314169 implements MigrationInterface {
  tables = ['migrations', 'project_locale', 'translation', 'project_client', 'term', 'project_user', 'plan', 'project', 'user', 'locale'];

  public async up(queryRunner: QueryRunner): Promise<any> {
    // Get the database type from the connection
    const dbType = queryRunner.connection.options.type;

    switch (dbType) {
      case DbType.MYSQL:
        await queryRunner.query('SET FOREIGN_KEY_CHECKS=0;');
        for (const table of this.tables) {
          await queryRunner.query(`ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        }
        await queryRunner.query('SET FOREIGN_KEY_CHECKS=1;');
        break;
      case DbType.POSTGRES:
        console.log('PostgreSQL uses UTF-8 by default, no encoding changes needed');
        // PostgreSQL uses UTF-8 by default, no action needed
        break;
      case DbType.BETTER_SQLITE3:
        console.log('SQLite uses UTF-8 by default, no encoding changes needed');
        // SQLite uses UTF-8 by default, no action needed
        break;
      default:
        console.log(`Database type '${dbType}' does not require encoding changes`);
    }
  }

  // No down migration since we cannot guess what the previous default encoding was
  public async down(queryRunner: QueryRunner): Promise<any> {}
}
