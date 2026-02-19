import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthEnhancements1771056000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS "is_email_verified" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "email_verification_token" varchar NULL,
        ADD COLUMN IF NOT EXISTS "email_verification_expires_at" TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS "password_reset_token" varchar NULL,
        ADD COLUMN IF NOT EXISTS "password_reset_expires_at" TIMESTAMP NULL
    `);

    // Mark all existing users as email-verified to prevent lockout
    await queryRunner.query(`
      UPDATE "users" SET "is_email_verified" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "password_reset_expires_at",
        DROP COLUMN "password_reset_token",
        DROP COLUMN "email_verification_expires_at",
        DROP COLUMN "email_verification_token",
        DROP COLUMN "is_email_verified",
        DROP COLUMN "locked_until",
        DROP COLUMN "failed_login_attempts"
    `);
  }
}
