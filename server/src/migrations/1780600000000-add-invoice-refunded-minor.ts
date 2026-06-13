import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceRefundedMinor1780600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN "refunded_minor" integer NOT NULL DEFAULT 0
    `);

    // Existing fully-refunded invoices predate cumulative tracking; treat their
    // entire total as already refunded so further refunds are rejected.
    await queryRunner.query(`
      UPDATE "billing_invoices"
      SET "refunded_minor" = "amount_minor"
      WHERE "status" = 'refunded'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_invoices" DROP COLUMN "refunded_minor"
    `);
  }
}
