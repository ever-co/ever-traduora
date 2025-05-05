import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class addProjectDescriptionField1543625461116 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE project ADD COLUMN description varchar(255) NULL;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `project` ADD `description` varchar(255) NULL');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "project" ADD COLUMN "description" TEXT NULL');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE project DROP COLUMN description;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `project` DROP COLUMN `description`');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query(`
          PRAGMA foreign_keys=off;
          
          BEGIN TRANSACTION;
          
         
          CREATE TABLE project_temp (
            "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
            "name" TEXT NOT NULL,
            "date_created" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "date_modified" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          
         
          INSERT INTO project_temp SELECT id, name, date_created, date_modified FROM project;
          
        
          DROP TABLE project;
          
         
          ALTER TABLE project_temp RENAME TO project;
          
      
          CREATE TRIGGER IF NOT EXISTS project_delete
           BEFORE DELETE ON "project"
           FOR EACH ROW
           BEGIN
             DELETE FROM "project_locale" WHERE "project_id" = OLD."id";
             DELETE FROM "project_user" WHERE "project_id" = OLD."id";
             DELETE FROM "term" WHERE "project_id" = OLD."id";
           END;
          
          COMMIT;
          
          PRAGMA foreign_keys=on;
        `);
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
