import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStepUpFailureAuditAction1784400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'STEP_UP_FAILURE'`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot remove an enum value, so this migration is one way.
  }
}
