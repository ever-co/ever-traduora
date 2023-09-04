import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';

export class addProjectDescriptionField1543625461116 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE project ADD COLUMN description varchar(255) NULL;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `project` ADD `description` varchar(255) NULL');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE project DROP COLUMN description;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `project` DROP COLUMN `description`');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
