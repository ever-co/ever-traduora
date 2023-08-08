import { MigrationInterface, QueryRunner } from 'typeorm';

export class providerGoogle1562578811334 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "encrypted_password" TYPE bytea USING "encrypted_password"::bytea;`);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "encrypted_password" SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "encrypted_password" TYPE bytea USING "encrypted_password"::bytea;`);

  }
}
