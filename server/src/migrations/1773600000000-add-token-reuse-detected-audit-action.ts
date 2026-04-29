import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenReuseDetectedAuditAction1773600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'TOKEN_REUSE_DETECTED'`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values — manual cleanup required if needed
  }
}
