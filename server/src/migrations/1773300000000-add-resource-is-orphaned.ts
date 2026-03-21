import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResourceIsOrphaned1773300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "is_orphaned" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'RESOURCE_RESTORE'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resources" DROP COLUMN IF EXISTS "is_orphaned"`
    );
    // PostgreSQL does not support removing enum values — manual cleanup required if needed
  }
}
