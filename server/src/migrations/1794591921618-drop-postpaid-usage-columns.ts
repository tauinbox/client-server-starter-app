import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropPostpaidUsageColumns1794591921618 implements MigrationInterface {
  name = 'DropPostpaidUsageColumns1794591921618';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Pay as you go is a prepaid credit balance: no subscription has a metered
    // window, and no invoice holds credit units.
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "metered_from"`
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "usage_sealed_until"`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" DROP COLUMN "credit_units_applied"`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" DROP COLUMN "credits_released_at"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" ADD "credits_released_at" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" ADD "credit_units_applied" integer NOT NULL DEFAULT 0`
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD "usage_sealed_until" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD "metered_from" TIMESTAMP WITH TIME ZONE`
    );
  }
}
