import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingCredits1780500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "billing_credit_balances" (
        "customer_id" uuid NOT NULL,
        "balance_units" integer NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_credit_balances" PRIMARY KEY ("customer_id"),
        CONSTRAINT "FK_billing_credit_balances_customer_id" FOREIGN KEY ("customer_id")
          REFERENCES "billing_customers"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "billing_credit_ledger" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "delta" integer NOT NULL,
        "reason" varchar(16) NOT NULL,
        "ref_invoice_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_credit_ledger" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_credit_ledger_customer_id" FOREIGN KEY ("customer_id")
          REFERENCES "billing_customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_credit_ledger_ref_invoice_id" FOREIGN KEY ("ref_invoice_id")
          REFERENCES "billing_invoices"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_credit_ledger_customer_id"
      ON "billing_credit_ledger" ("customer_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "billing_credit_ledger"`);
    await queryRunner.query(`DROP TABLE "billing_credit_balances"`);
  }
}
