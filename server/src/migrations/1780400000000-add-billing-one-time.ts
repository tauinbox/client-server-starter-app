import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingOneTime1780400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "billing_products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" varchar(100) NOT NULL,
        "name" varchar(100) NOT NULL,
        "description" varchar(500) NULL,
        "type" varchar(16) NOT NULL,
        "prices" jsonb NOT NULL,
        "grant" jsonb NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_products" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_products_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "billing_customer_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "entitlement" varchar(100) NOT NULL,
        "source_invoice_id" uuid NOT NULL,
        "expires_at" TIMESTAMP NULL,
        "revoked_at" TIMESTAMP NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_customer_grants" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_customer_grants_customer_id" FOREIGN KEY ("customer_id")
          REFERENCES "billing_customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_customer_grants_source_invoice_id" FOREIGN KEY ("source_invoice_id")
          REFERENCES "billing_invoices"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_customer_grants_customer_id"
      ON "billing_customer_grants" ("customer_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD "kind" varchar(16) NOT NULL DEFAULT 'subscription'
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD "product_id" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD CONSTRAINT "FK_billing_invoices_product_id"
        FOREIGN KEY ("product_id")
        REFERENCES "billing_products"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      DROP CONSTRAINT "FK_billing_invoices_product_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices" DROP COLUMN "product_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices" DROP COLUMN "kind"
    `);
    await queryRunner.query(`DROP TABLE "billing_customer_grants"`);
    await queryRunner.query(`DROP TABLE "billing_products"`);
  }
}
