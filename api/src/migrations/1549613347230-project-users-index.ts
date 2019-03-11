import { MigrationInterface, QueryRunner } from 'typeorm';

export class projectUsersIndex1549613347230 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('CREATE UNIQUE INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user`(`projectId`, `userId`)');
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('DROP INDEX `IDX_20543d6caa7324ce6706fad2f5` ON `project_user`');
  }
}
