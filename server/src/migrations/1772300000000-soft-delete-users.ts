import { MigrationInterface, QueryRunner } from 'typeorm';

export class SoftDeleteUsers1772300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ NULL`
    );

    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'USER_RESTORE'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);
    // PostgreSQL does not support removing enum values — manual cleanup required if needed
  }
}
