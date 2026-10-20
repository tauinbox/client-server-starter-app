import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceCreditsReleasedAt1786200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // When an unpaid invoice stopped holding its credit units; NULL while the
    // units are held (pending or failed) or spent (paid).
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN "credits_released_at" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      DROP COLUMN "credits_released_at"
    `);
  }
}
