import { MigrationInterface, QueryRunner } from 'typeorm';

export class addTranslationTag1569058921044 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      'CREATE TABLE `tag` (`id` varchar(36) NOT NULL, `value` varchar(255) NOT NULL, `projectId` varchar(36) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_171dadf4b0b751badd68de0bd3` (`projectId`, `value`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'CREATE TABLE `translation_tag` (`id` varchar(36) NOT NULL, `translationTermId` varchar(36) NOT NULL, `translationProjectLocaleId` varchar(36) NOT NULL, `tagId` varchar(36) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'ALTER TABLE `tag` ADD CONSTRAINT `FK_5ed9c8937635b255539d31b2cce` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `translation_tag` ADD CONSTRAINT `FK_c24dfa2eac5c3b109e2210b5d94` FOREIGN KEY (`translationTermId`, `translationProjectLocaleId`) REFERENCES `translation`(`termId`,`projectLocaleId`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `translation_tag` ADD CONSTRAINT `FK_b155a521b54864b19b4093ccea7` FOREIGN KEY (`tagId`) REFERENCES `tag`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `translation_tag` DROP FOREIGN KEY `FK_b155a521b54864b19b4093ccea7`');
    await queryRunner.query('ALTER TABLE `translation_tag` DROP FOREIGN KEY `FK_c24dfa2eac5c3b109e2210b5d94`');
    await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_52b10ad0b87f2f52ed24b7dc451`');
    await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_f7f6e4a8de56880547c414276be`');
    await queryRunner.query('ALTER TABLE `tag` DROP FOREIGN KEY `FK_5ed9c8937635b255539d31b2cce`');
    await queryRunner.query('DROP TABLE `translation_tag`');
    await queryRunner.query('DROP INDEX `IDX_171dadf4b0b751badd68de0bd3` ON `tag`');
    await queryRunner.query('DROP TABLE `tag`');
  }
}
