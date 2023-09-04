import { MigrationInterface, QueryRunner } from 'typeorm';

import { config } from '../config';

export class fixTranslationsPrimaryKey1542044660604 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE "translation" DROP CONSTRAINT "translation_pkey";
    `);
        await queryRunner.query(`ALTER TABLE "translation" DROP COLUMN "id";`);
        await queryRunner.query(`ALTER TABLE "translation" ADD PRIMARY KEY ("term_id", "project_locale_id");`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `translation` DROP PRIMARY KEY');
        await queryRunner.query('ALTER TABLE `translation` DROP COLUMN `id`');
        await queryRunner.query('ALTER TABLE `translation` ADD PRIMARY KEY (`termId`, `projectLocaleId`)');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case 'postgres':
        await queryRunner.query(`ALTER TABLE translation DROP CONSTRAINT translation_pkey;`);
        await queryRunner.query(`ALTER TABLE translation ADD id SERIAL PRIMARY KEY;
    `);
        await queryRunner.query(`ALTER TABLE "translation" ADD COLUMN "id" varchar(255) NOT NULL PRIMARY KEY;`);
        break;
      case 'mysql':
        await queryRunner.query('ALTER TABLE `translation` DROP PRIMARY KEY');
        await queryRunner.query('ALTER TABLE `translation` ADD `id` varchar(255) NOT NULL');
        await queryRunner.query('ALTER TABLE `translation` ADD PRIMARY KEY (`id`)');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
