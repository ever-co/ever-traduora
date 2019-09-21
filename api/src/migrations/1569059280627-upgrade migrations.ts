import { MigrationInterface, QueryRunner } from 'typeorm';

export class upgradeMigrations1569059280627 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `project_client` DROP FOREIGN KEY `FK_aed9d0c639a1d484d38bd3d0d74`');
    await queryRunner.query('ALTER TABLE `project_locale` DROP FOREIGN KEY `FK_3adfd3457f80d19efe53c8e5754`');
    await queryRunner.query('ALTER TABLE `project_user` DROP FOREIGN KEY `FK_be4e7ad73afd703f94b8866eb6b`');
    await queryRunner.query('ALTER TABLE `term` DROP FOREIGN KEY `FK_b541fb8d0122efed5c870d55b15`');
    await queryRunner.query('ALTER TABLE `project` CHANGE `id` `id` varchar(36) NOT NULL');
    await queryRunner.query('ALTER TABLE `project` CHANGE `description` `description` varchar(255) NULL DEFAULT null');
    await queryRunner.query('ALTER TABLE `project_user` DROP FOREIGN KEY `FK_8d75193a81f827ba8d58575e637`');
    await queryRunner.query('ALTER TABLE `user` CHANGE `id` `id` varchar(36) NOT NULL');
    await queryRunner.query('DROP INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user`');
    await queryRunner.query('ALTER TABLE `project_user` CHANGE `id` `id` varchar(36) NOT NULL');
    await queryRunner.query('ALTER TABLE `project_user` CHANGE `projectId` `projectId` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `project_user` CHANGE `userId` `userId` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `project_client` CHANGE `id` `id` varchar(36) NOT NULL');
    await queryRunner.query('ALTER TABLE `project_client` CHANGE `projectId` `projectId` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_52b10ad0b87f2f52ed24b7dc451`');
    await queryRunner.query('DROP INDEX `IDX_2eaddab6fd95ae7425fc346db1` ON `project_locale`');
    await queryRunner.query('ALTER TABLE `project_locale` CHANGE `id` `id` varchar(36) NOT NULL');
    await queryRunner.query('ALTER TABLE `project_locale` CHANGE `projectId` `projectId` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_f7f6e4a8de56880547c414276be`');
    await queryRunner.query('DROP INDEX `IDX_5f4321d5b62e77d1c7004e7b74` ON `term`');
    await queryRunner.query('ALTER TABLE `term` CHANGE `id` `id` varchar(36) NOT NULL');
    await queryRunner.query('ALTER TABLE `term` CHANGE `projectId` `projectId` varchar(36) NOT NULL');
    await queryRunner.query('CREATE UNIQUE INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user` (`projectId`, `userId`)');
    await queryRunner.query('CREATE UNIQUE INDEX `IDX_2eaddab6fd95ae7425fc346db1` ON `project_locale` (`projectId`, `localeCode`)');
    await queryRunner.query('CREATE UNIQUE INDEX `IDX_5f4321d5b62e77d1c7004e7b74` ON `term` (`projectId`, `value`)');
    await queryRunner.query(
      'ALTER TABLE `project_user` ADD CONSTRAINT `FK_be4e7ad73afd703f94b8866eb6b` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `project_user` ADD CONSTRAINT `FK_8d75193a81f827ba8d58575e637` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `project_client` ADD CONSTRAINT `FK_aed9d0c639a1d484d38bd3d0d74` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `project_locale` ADD CONSTRAINT `FK_3adfd3457f80d19efe53c8e5754` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `translation` ADD CONSTRAINT `FK_f7f6e4a8de56880547c414276be` FOREIGN KEY (`termId`) REFERENCES `term`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `translation` ADD CONSTRAINT `FK_52b10ad0b87f2f52ed24b7dc451` FOREIGN KEY (`projectLocaleId`) REFERENCES `project_locale`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `term` ADD CONSTRAINT `FK_b541fb8d0122efed5c870d55b15` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `term` DROP FOREIGN KEY `FK_b541fb8d0122efed5c870d55b15`');
    await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_52b10ad0b87f2f52ed24b7dc451`');
    await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_f7f6e4a8de56880547c414276be`');
    await queryRunner.query('ALTER TABLE `project_locale` DROP FOREIGN KEY `FK_3adfd3457f80d19efe53c8e5754`');
    await queryRunner.query('ALTER TABLE `project_client` DROP FOREIGN KEY `FK_aed9d0c639a1d484d38bd3d0d74`');
    await queryRunner.query('ALTER TABLE `project_user` DROP FOREIGN KEY `FK_8d75193a81f827ba8d58575e637`');
    await queryRunner.query('ALTER TABLE `project_user` DROP FOREIGN KEY `FK_be4e7ad73afd703f94b8866eb6b`');
    await queryRunner.query('DROP INDEX `IDX_5f4321d5b62e77d1c7004e7b74` ON `term`');
    await queryRunner.query('DROP INDEX `IDX_2eaddab6fd95ae7425fc346db1` ON `project_locale`');
    await queryRunner.query('DROP INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user`');
    await queryRunner.query('ALTER TABLE `term` CHANGE `projectId` `projectId` varchar(255) COLLATE "utf8mb4_unicode_ci" NOT NULL');
    await queryRunner.query('ALTER TABLE `term` CHANGE `id` `id` varchar(255) COLLATE "utf8mb4_unicode_ci" NOT NULL');
    await queryRunner.query('CREATE UNIQUE INDEX `IDX_5f4321d5b62e77d1c7004e7b74` ON `term` (`projectId`, `value`)');
    await queryRunner.query(
      'ALTER TABLE `translation` ADD CONSTRAINT `FK_f7f6e4a8de56880547c414276be` FOREIGN KEY (`termId`) REFERENCES `term`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query('ALTER TABLE `project_locale` CHANGE `projectId` `projectId` varchar(255) COLLATE "utf8mb4_unicode_ci" NULL');
    await queryRunner.query('ALTER TABLE `project_locale` CHANGE `id` `id` varchar(255) COLLATE "utf8mb4_unicode_ci" NOT NULL');
    await queryRunner.query('CREATE UNIQUE INDEX `IDX_2eaddab6fd95ae7425fc346db1` ON `project_locale` (`projectId`, `localeCode`)');
    await queryRunner.query(
      'ALTER TABLE `translation` ADD CONSTRAINT `FK_52b10ad0b87f2f52ed24b7dc451` FOREIGN KEY (`projectLocaleId`) REFERENCES `project_locale`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query('ALTER TABLE `project_client` CHANGE `projectId` `projectId` varchar(255) COLLATE "utf8mb4_unicode_ci" NULL');
    await queryRunner.query('ALTER TABLE `project_client` CHANGE `id` `id` varchar(255) COLLATE "utf8mb4_unicode_ci" NOT NULL');
    await queryRunner.query('ALTER TABLE `project_user` CHANGE `userId` `userId` varchar(255) COLLATE "utf8mb4_unicode_ci" NULL');
    await queryRunner.query('ALTER TABLE `project_user` CHANGE `projectId` `projectId` varchar(255) COLLATE "utf8mb4_unicode_ci" NULL');
    await queryRunner.query('ALTER TABLE `project_user` CHANGE `id` `id` varchar(255) COLLATE "utf8mb4_unicode_ci" NOT NULL');
    await queryRunner.query('CREATE UNIQUE INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user` (`projectId`, `userId`)');
    await queryRunner.query('ALTER TABLE `user` CHANGE `id` `id` varchar(255) COLLATE "utf8mb4_unicode_ci" NOT NULL');
    await queryRunner.query(
      'ALTER TABLE `project_user` ADD CONSTRAINT `FK_8d75193a81f827ba8d58575e637` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query('ALTER TABLE `project` CHANGE `description` `description` varchar(255) COLLATE "utf8mb4_unicode_ci" NULL');
    await queryRunner.query('ALTER TABLE `project` CHANGE `id` `id` varchar(255) COLLATE "utf8mb4_unicode_ci" NOT NULL');
    await queryRunner.query(
      'ALTER TABLE `term` ADD CONSTRAINT `FK_b541fb8d0122efed5c870d55b15` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `project_user` ADD CONSTRAINT `FK_be4e7ad73afd703f94b8866eb6b` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `project_locale` ADD CONSTRAINT `FK_3adfd3457f80d19efe53c8e5754` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      'ALTER TABLE `project_client` ADD CONSTRAINT `FK_aed9d0c639a1d484d38bd3d0d74` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }
}
