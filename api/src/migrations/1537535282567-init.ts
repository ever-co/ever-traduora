import { MigrationInterface, QueryRunner } from 'typeorm';

export class init1537535282567 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(
      'CREATE TABLE `project` (`id` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'CREATE TABLE `project_locale` (`id` varchar(255) NOT NULL, `localeCode` varchar(255) NULL, `projectId` varchar(255) NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_2eaddab6fd95ae7425fc346db1` (`projectId`, `localeCode`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'CREATE TABLE `user` (`id` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `email` varchar(255) NOT NULL, `encryptedPassword` binary(60) NOT NULL, `encryptedPasswordResetToken` blob NULL, `passwordResetExpires` timestamp(6) NULL, `loginAttempts` int NOT NULL DEFAULT 0, `lastLogin` timestamp(6) NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_e12875dfb3b1d92d7d7c5377e2` (`email`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'CREATE TABLE `project_user` (`id` varchar(255) NOT NULL, `projectId` varchar(255) NULL, `userId` varchar(255) NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'CREATE TABLE `term` (`id` varchar(255) NOT NULL, `value` varchar(255) NOT NULL, `projectId` varchar(255) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_5f4321d5b62e77d1c7004e7b74` (`projectId`, `value`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'CREATE TABLE `translation` (`id` varchar(255) NOT NULL, `value` varchar(255) NOT NULL, `termId` varchar(255) NOT NULL, `projectLocaleId` varchar(255) NOT NULL, `dateCreated` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `dateModified` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB',
    );
    await queryRunner.query(
      'ALTER TABLE `project_locale` ADD CONSTRAINT `FK_a2a11dc444732d36e2b3f08fe4b` FOREIGN KEY (`localeCode`) REFERENCES `locale`(`code`) ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE `project_locale` ADD CONSTRAINT `FK_3adfd3457f80d19efe53c8e5754` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE `project_user` ADD CONSTRAINT `FK_be4e7ad73afd703f94b8866eb6b` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE `project_user` ADD CONSTRAINT `FK_8d75193a81f827ba8d58575e637` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE `term` ADD CONSTRAINT `FK_b541fb8d0122efed5c870d55b15` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE `translation` ADD CONSTRAINT `FK_f7f6e4a8de56880547c414276be` FOREIGN KEY (`termId`) REFERENCES `term`(`id`) ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE `translation` ADD CONSTRAINT `FK_52b10ad0b87f2f52ed24b7dc451` FOREIGN KEY (`projectLocaleId`) REFERENCES `project_locale`(`id`) ON DELETE CASCADE',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_52b10ad0b87f2f52ed24b7dc451`');
    await queryRunner.query('ALTER TABLE `translation` DROP FOREIGN KEY `FK_f7f6e4a8de56880547c414276be`');
    await queryRunner.query('ALTER TABLE `term` DROP FOREIGN KEY `FK_b541fb8d0122efed5c870d55b15`');
    await queryRunner.query('ALTER TABLE `project_user` DROP FOREIGN KEY `FK_8d75193a81f827ba8d58575e637`');
    await queryRunner.query('ALTER TABLE `project_user` DROP FOREIGN KEY `FK_be4e7ad73afd703f94b8866eb6b`');
    await queryRunner.query('ALTER TABLE `project_locale` DROP FOREIGN KEY `FK_3adfd3457f80d19efe53c8e5754`');
    await queryRunner.query('ALTER TABLE `project_locale` DROP FOREIGN KEY `FK_a2a11dc444732d36e2b3f08fe4b`');
    await queryRunner.query('DROP INDEX `IDX_fd325cc6295e7207a8d8ec7e83` ON `translation`');
    await queryRunner.query('DROP TABLE `translation`');
    await queryRunner.query('DROP INDEX `IDX_5f4321d5b62e77d1c7004e7b74` ON `term`');
    await queryRunner.query('DROP TABLE `term`');
    await queryRunner.query('DROP TABLE `project_user`');
    await queryRunner.query('DROP INDEX `IDX_e12875dfb3b1d92d7d7c5377e2` ON `user`');
    await queryRunner.query('DROP TABLE `user`');
    await queryRunner.query('DROP INDEX `IDX_2eaddab6fd95ae7425fc346db1` ON `project_locale`');
    await queryRunner.query('DROP TABLE `project_locale`');
    await queryRunner.query('DROP TABLE `project`');
  }
}
