import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestrictBillingFinancialFks1781300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Invoices and the credit ledger are financial/audit records: a hard
    // delete of a customer must never silently destroy them, so their FKs
    // switch from CASCADE to RESTRICT. Operational rows (subscriptions,
    // payment methods, usage records, grants, balances) keep CASCADE.
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      DROP CONSTRAINT "FK_billing_invoices_customer_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD CONSTRAINT "FK_billing_invoices_customer_id"
        FOREIGN KEY ("customer_id")
        REFERENCES "billing_customers"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_credit_ledger"
      DROP CONSTRAINT "FK_billing_credit_ledger_customer_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_credit_ledger"
      ADD CONSTRAINT "FK_billing_credit_ledger_customer_id"
        FOREIGN KEY ("customer_id")
        REFERENCES "billing_customers"("id") ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_credit_ledger"
      DROP CONSTRAINT "FK_billing_credit_ledger_customer_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_credit_ledger"
      ADD CONSTRAINT "FK_billing_credit_ledger_customer_id"
        FOREIGN KEY ("customer_id")
        REFERENCES "billing_customers"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      DROP CONSTRAINT "FK_billing_invoices_customer_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD CONSTRAINT "FK_billing_invoices_customer_id"
        FOREIGN KEY ("customer_id")
        REFERENCES "billing_customers"("id") ON DELETE CASCADE
    `);
  }
}
