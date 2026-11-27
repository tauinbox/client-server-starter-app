import { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The audit action of a change of the public status of a region. The audit
 * rows are regional, so the value goes into the enum of every pool.
 */
export class AddRegionStatusAuditAction1796000000000 implements MigrationInterface {
  name = 'AddRegionStatusAuditAction1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'REGION_STATUS_UPDATE'`
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot remove a value from an enum type.
  }
}
