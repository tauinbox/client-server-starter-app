import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentMethodRemovedAt1794667633786 implements MigrationInterface {
  name = 'AddPaymentMethodRemovedAt1794667633786';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_customers" ADD "payment_method_removed_at" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'BILLING_PAYMENT_METHOD_REMOVE'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_customers" DROP COLUMN "payment_method_removed_at"`
    );
    // PostgreSQL cannot remove an enum value; BILLING_PAYMENT_METHOD_REMOVE stays.
  }
}
