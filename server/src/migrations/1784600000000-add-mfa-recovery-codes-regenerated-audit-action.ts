import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMfaRecoveryCodesRegeneratedAuditAction1784600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'MFA_RECOVERY_CODES_REGENERATED'`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot remove an enum value, so this migration is one way.
  }
}
