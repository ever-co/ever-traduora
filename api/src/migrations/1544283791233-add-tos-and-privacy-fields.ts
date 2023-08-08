import { MigrationInterface, QueryRunner } from "typeorm";

export class addTosAndPrivacyFields1544283791233 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "user" ADD "tos_and_privacy_accepted_date" timestamp NULL;`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "tos_and_privacy_accepted_version" varchar(255) NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_version"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "tos_and_privacy_accepted_date"; `);
  }
}
