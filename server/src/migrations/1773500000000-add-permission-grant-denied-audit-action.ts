import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermissionGrantDeniedAuditAction1773500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'PERMISSION_GRANT_DENIED'`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values — manual cleanup required if needed
  }
}
