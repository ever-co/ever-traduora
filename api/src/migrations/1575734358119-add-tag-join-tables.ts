import { MigrationInterface, QueryRunner } from 'typeorm';

export class addTagJoinTables1575734358119 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      'CREATE TABLE `tag_terms_term` (`tagId` varchar(255) NOT NULL, `termId` varchar(255) NOT NULL, INDEX `IDX_fe6fef74dbcdde7bf8727ea4b9` (`tagId`), INDEX `IDX_f7ce5f99c00bdc74dd42809b6d` (`termId`), PRIMARY KEY (`tagId`, `termId`)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    );

    await queryRunner.query(
      'CREATE TABLE `tag_translations_translation` (`tagId` varchar(255) NOT NULL, `translationTermId` varchar(255) NOT NULL, `translationProjectLocaleId` varchar(255) NOT NULL, INDEX `IDX_957f3fe5cf7454257be8643575` (`tagId`), INDEX `IDX_e23da620cb42782a14167e9dbe` (`translationTermId`, `translationProjectLocaleId`), PRIMARY KEY (`tagId`, `translationTermId`, `translationProjectLocaleId`)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    );

    await queryRunner.query(
      'ALTER TABLE `tag_terms_term` ADD CONSTRAINT `FK_fe6fef74dbcdde7bf8727ea4b96` FOREIGN KEY (`tagId`) REFERENCES `tag`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );

    await queryRunner.query(
      'ALTER TABLE `tag_terms_term` ADD CONSTRAINT `FK_f7ce5f99c00bdc74dd42809b6dc` FOREIGN KEY (`termId`) REFERENCES `term`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );

    await queryRunner.query(
      'ALTER TABLE `tag_translations_translation` ADD CONSTRAINT `FK_957f3fe5cf7454257be8643575c` FOREIGN KEY (`tagId`) REFERENCES `tag`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );

    await queryRunner.query(
      'ALTER TABLE `tag_translations_translation` ADD CONSTRAINT `FK_e23da620cb42782a14167e9dbe7` FOREIGN KEY (`translationTermId`, `translationProjectLocaleId`) REFERENCES `translation`(`termId`,`projectLocaleId`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `tag_translations_translation` DROP FOREIGN KEY `FK_e23da620cb42782a14167e9dbe7`');
    await queryRunner.query('ALTER TABLE `tag_translations_translation` DROP FOREIGN KEY `FK_957f3fe5cf7454257be8643575c`');
    await queryRunner.query('ALTER TABLE `tag_terms_term` DROP FOREIGN KEY `FK_f7ce5f99c00bdc74dd42809b6dc`');
    await queryRunner.query('ALTER TABLE `tag_terms_term` DROP FOREIGN KEY `FK_fe6fef74dbcdde7bf8727ea4b96`');
    await queryRunner.query('DROP INDEX `IDX_e23da620cb42782a14167e9dbe` ON `tag_translations_translation`');
    await queryRunner.query('DROP INDEX `IDX_957f3fe5cf7454257be8643575` ON `tag_translations_translation`');
    await queryRunner.query('DROP TABLE `tag_translations_translation`');
    await queryRunner.query('DROP INDEX `IDX_f7ce5f99c00bdc74dd42809b6d` ON `tag_terms_term`');
    await queryRunner.query('DROP INDEX `IDX_fe6fef74dbcdde7bf8727ea4b9` ON `tag_terms_term`');
    await queryRunner.query('DROP TABLE `tag_terms_term`');
  }
}
