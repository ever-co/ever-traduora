import { MigrationInterface, QueryRunner } from 'typeorm';

export class addTranslationTag1575719158140 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      'CREATE TABLE `tag` (`id` varchar(255) NOT NULL, `value` varchar(255) NOT NULL, `color` varchar(7) NOT NULL,  `projectId` varchar(255) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_project_terms` (`projectId`, `value`), PRIMARY KEY (`id`)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    );
    await queryRunner.query(
      'CREATE TABLE `term_tag` (`id` varchar(255) NOT NULL, `termId` varchar(255) NOT NULL, `tagId` varchar(255) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    );
    await queryRunner.query(
      'CREATE TABLE `translation_tag` (`id` varchar(255) NOT NULL, `translationTermId` varchar(255) NOT NULL, `translationProjectLocaleId` varchar(255) NOT NULL, `tagId` varchar(255) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    );
    await queryRunner.query(
      'ALTER TABLE `tag` ADD CONSTRAINT `FK_project` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `term_tag` ADD CONSTRAINT `FK_term` FOREIGN KEY (`termId`) REFERENCES `term`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `translation_tag` ADD CONSTRAINT `FK_translation` FOREIGN KEY (`translationTermId`, `translationProjectLocaleId`) REFERENCES `translation`(`termId`,`projectLocaleId`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `translation_tag` ADD CONSTRAINT `FK_tag` FOREIGN KEY (`tagId`) REFERENCES `tag`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `term_tag` DROP FOREIGN KEY `FK_term`');
    await queryRunner.query('ALTER TABLE `translation_tag` DROP FOREIGN KEY `FK_tag`');
    await queryRunner.query('ALTER TABLE `translation_tag` DROP FOREIGN KEY `FK_translation`');
    await queryRunner.query('ALTER TABLE `tag` DROP FOREIGN KEY `FK_project`');
    await queryRunner.query('DROP TABLE `term_tag`');
    await queryRunner.query('DROP TABLE `translation_tag`');
    await queryRunner.query('DROP INDEX `IDX_project_terms` ON `tag`');
    await queryRunner.query('DROP TABLE `tag`');
  }
}
