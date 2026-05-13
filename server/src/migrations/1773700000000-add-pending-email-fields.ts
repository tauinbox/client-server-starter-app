import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingEmailFields1773700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "pending_email" varchar NULL,
        ADD COLUMN IF NOT EXISTS "pending_email_token" varchar NULL,
        ADD COLUMN IF NOT EXISTS "pending_email_expires_at" TIMESTAMP NULL
    `);

    // Enforce uniqueness on pending_email across all rows so two users cannot
    // hold the same address in flight simultaneously. Partial + case-insensitive
    // to mirror how Postgres compares email values elsewhere.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "users_pending_email_lower_uq"
        ON "users" (LOWER("pending_email"))
        WHERE "pending_email" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'USER_EMAIL_CHANGE_REQUEST'`
    );
    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'USER_EMAIL_CHANGE_COMPLETE'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "users_pending_email_lower_uq"`
    );
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "pending_email_expires_at",
        DROP COLUMN IF EXISTS "pending_email_token",
        DROP COLUMN IF EXISTS "pending_email"
    `);
    // PostgreSQL does not support removing enum values — manual cleanup required if needed
  }
}
