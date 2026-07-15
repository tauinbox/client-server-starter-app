import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceCreditUnitsApplied1783200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN "credit_units_applied" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_invoices" DROP COLUMN "credit_units_applied"
    `);
  }
}
