import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTotpLastUsedStep1784500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The RFC 6238 time step of the last code the account spent. `bigint`
    // because the step is a 64-bit counter in the RFC; NULL is the floor a
    // fresh enrolment starts from.
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "totp_last_used_step" bigint NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "totp_last_used_step"
    `);
  }
}
