import { MigrationInterface, QueryRunner } from 'typeorm';

export class changeTermsValueType1591268945309 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `term` DROP FOREIGN KEY `FK_b541fb8d0122efed5c870d55b15`');
    await queryRunner.query('ALTER TABLE `term` DROP key `IDX_5f4321d5b62e77d1c7004e7b74`');
    await queryRunner.query('ALTER TABLE `term` MODIFY COLUMN `value` text NOT NULL');
    await queryRunner.query(
      'ALTER TABLE `term` ADD CONSTRAINT `FK_b541fb8d0122efed5c870d55b15` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `term` DROP FOREIGN KEY `FK_b541fb8d0122efed5c870d55b15`');
    await queryRunner.query('ALTER TABLE `term` MODIFY COLUMN `value` varchar(255) NOT NULL');
    await queryRunner.query('CREATE UNIQUE INDEX `IDX_5f4321d5b62e77d1c7004e7b74` ON `term` (`projectId`, `value`)');
    await queryRunner.query(
      'ALTER TABLE `term` ADD CONSTRAINT `FK_b541fb8d0122efed5c870d55b15` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
    );
  }
}
