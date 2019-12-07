import { MigrationInterface, QueryRunner } from 'typeorm';

export class addTag1575719158140 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      'CREATE TABLE `tag` (`id` varchar(255) NOT NULL, `value` varchar(255) NOT NULL, `color` varchar(7) NOT NULL, `projectId` varchar(255) NOT NULL, UNIQUE INDEX `IDX_project_terms` (`projectId`, `value`), PRIMARY KEY (`id`)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    );
    await queryRunner.query(
      'ALTER TABLE `tag` ADD CONSTRAINT `FK_project` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query('CREATE UNIQUE INDEX `IDX_171dadf4b0b751badd68de0bd3` ON `tag` (`projectId`, `value`)');
    await queryRunner.query(
      'ALTER TABLE `tag` ADD CONSTRAINT `FK_5ed9c8937635b255539d31b2cce` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `tag` DROP FOREIGN KEY `FK_5ed9c8937635b255539d31b2cce`');
    await queryRunner.query('DROP INDEX `IDX_171dadf4b0b751badd68de0bd3` ON `tag`');
    await queryRunner.query('ALTER TABLE `tag` DROP FOREIGN KEY `FK_project`');
    await queryRunner.query('DROP TABLE `tag`');
  }
}
