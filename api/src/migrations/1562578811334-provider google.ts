import { MigrationInterface, QueryRunner } from 'typeorm';

export class providerGoogle1562578811334 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `user` CHANGE `encryptedPassword` `encryptedPassword` binary(60) NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('ALTER TABLE `user` CHANGE `encryptedPassword` `encryptedPassword` binary(60) NOT NULL');
  }
}
