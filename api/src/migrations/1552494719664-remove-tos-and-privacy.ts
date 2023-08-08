import { MigrationInterface, QueryRunner } from 'typeorm';

export class removeTosAndPrivacy1552494719664 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_date";`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_version";`);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" varchar(255) NULL;`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_date" timestamp(6) NULL;`);
  }
}
