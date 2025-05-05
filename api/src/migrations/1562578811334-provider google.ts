import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { DbType } from '../utils/database-type-helper';

export class providerGoogle1562578811334 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "encrypted_password" TYPE bytea USING "encrypted_password"::bytea;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` CHANGE `encryptedPassword` `encryptedPassword` binary(60) NULL');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "encrypted_password_temp" BLOB');
        await queryRunner.query('UPDATE "user" SET "encrypted_password_temp" = CAST("encrypted_password" AS BLOB)');
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "encrypted_password"');
        await queryRunner.query('ALTER TABLE "user" RENAME COLUMN "encrypted_password_temp" TO "encrypted_password"');
        break;
      default:
        console.log('Unknown DB type');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    switch (config.db.default.type) {
      case DbType.POSTGRES:
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "encrypted_password" SET NOT NULL;`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "encrypted_password" TYPE bytea USING "encrypted_password"::bytea;`);
        break;
      case DbType.MYSQL:
        await queryRunner.query('ALTER TABLE `user` CHANGE `encryptedPassword` `encryptedPassword` binary(60) NOT NULL');
        break;
      case DbType.BETTER_SQLITE3:
        await queryRunner.query('ALTER TABLE "user" ADD COLUMN "encrypted_password_temp" TEXT');
        await queryRunner.query('UPDATE "user" SET "encrypted_password_temp" = CAST("encrypted_password" AS TEXT)');
        await queryRunner.query('ALTER TABLE "user" DROP COLUMN "encrypted_password"');
        await queryRunner.query('ALTER TABLE "user" RENAME COLUMN "encrypted_password_temp" TO "encrypted_password"');
        break;
      default:
        console.log('Unknown DB type');
    }
  }
}
