import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBilling1779900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" varchar(100) NOT NULL,
        "name" varchar(100) NOT NULL,
        "description" varchar(500) NULL,
        "billing_mode" varchar(16) NOT NULL,
        "interval" varchar(16) NOT NULL,
        "meter_key" varchar(100) NULL,
        "entitlements" text[] NOT NULL DEFAULT '{}',
        "limits" jsonb NULL,
        "trial_days" integer NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        "prices" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plans" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_plans_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_plans_entitlements"
      ON "plans" USING gin ("entitlements")
    `);

    await queryRunner.query(`
      CREATE TABLE "billing_customers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "provider" varchar(32) NOT NULL,
        "provider_override" varchar(32) NULL,
        "provider_customer_id" varchar(255) NULL,
        "country" varchar(2) NOT NULL,
        "currency" varchar(3) NOT NULL,
        "default_payment_method_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_customers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_customers_user_id" UNIQUE ("user_id"),
        CONSTRAINT "FK_billing_customers_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "billing_payment_methods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "provider" varchar(32) NOT NULL,
        "provider_method_ref" varchar(255) NOT NULL,
        "brand" varchar(32) NOT NULL,
        "last4" varchar(4) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_payment_methods" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_payment_methods_customer_id" FOREIGN KEY ("customer_id")
          REFERENCES "billing_customers"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_payment_methods_customer_id"
      ON "billing_payment_methods" ("customer_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_customers"
      ADD CONSTRAINT "FK_billing_customers_default_payment_method_id"
        FOREIGN KEY ("default_payment_method_id")
        REFERENCES "billing_payment_methods"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "plan_key" varchar(100) NOT NULL,
        "provider" varchar(32) NOT NULL,
        "billing_mode" varchar(16) NOT NULL,
        "status" varchar(32) NOT NULL,
        "lifecycle_owner" varchar(16) NOT NULL,
        "current_period_start" TIMESTAMP NOT NULL,
        "current_period_end" TIMESTAMP NOT NULL,
        "cancel_at_period_end" boolean NOT NULL DEFAULT false,
        "trial_end" TIMESTAMP NULL,
        "provider_subscription_id" varchar(255) NULL,
        "payment_method_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscriptions_customer_id" FOREIGN KEY ("customer_id")
          REFERENCES "billing_customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_subscriptions_payment_method_id" FOREIGN KEY ("payment_method_id")
          REFERENCES "billing_payment_methods"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_subscriptions_customer_id"
      ON "subscriptions" ("customer_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "billing_invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "subscription_id" uuid NULL,
        "provider" varchar(32) NOT NULL,
        "provider_event_id" varchar(255) NULL,
        "provider_invoice_ref" varchar(255) NOT NULL,
        "amount_minor" integer NOT NULL,
        "currency" varchar(3) NOT NULL,
        "status" varchar(16) NOT NULL,
        "billing_mode" varchar(16) NOT NULL,
        "period_start" TIMESTAMP NOT NULL,
        "period_end" TIMESTAMP NOT NULL,
        "paid_at" TIMESTAMP NULL,
        "receipt_ref" varchar(255) NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_invoices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_invoices_provider_event_id" UNIQUE ("provider_event_id"),
        CONSTRAINT "FK_billing_invoices_customer_id" FOREIGN KEY ("customer_id")
          REFERENCES "billing_customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_invoices_subscription_id" FOREIGN KEY ("subscription_id")
          REFERENCES "subscriptions"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_invoices_customer_id"
      ON "billing_invoices" ("customer_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "billing_usage_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "subscription_id" uuid NOT NULL,
        "meter_key" varchar(100) NOT NULL,
        "quantity" integer NOT NULL,
        "occurred_at" TIMESTAMP NOT NULL,
        "idempotency_key" varchar(255) NOT NULL,
        "recorded_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_usage_records" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_usage_records_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "FK_billing_usage_records_customer_id" FOREIGN KEY ("customer_id")
          REFERENCES "billing_customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_usage_records_subscription_id" FOREIGN KEY ("subscription_id")
          REFERENCES "subscriptions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_usage_records_subscription_id"
      ON "billing_usage_records" ("subscription_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "billing_webhook_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" varchar(32) NOT NULL,
        "provider_event_id" varchar(255) NOT NULL,
        "type" varchar(255) NOT NULL,
        "payload_hash" varchar(255) NOT NULL,
        "status" varchar(16) NOT NULL,
        "received_at" TIMESTAMP NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMP NULL,
        CONSTRAINT "PK_billing_webhook_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_webhook_events_provider_event"
          UNIQUE ("provider", "provider_event_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "billing_webhook_events"`);
    await queryRunner.query(`DROP TABLE "billing_usage_records"`);
    await queryRunner.query(`DROP TABLE "billing_invoices"`);
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`
      ALTER TABLE "billing_customers"
      DROP CONSTRAINT "FK_billing_customers_default_payment_method_id"
    `);
    await queryRunner.query(`DROP TABLE "billing_payment_methods"`);
    await queryRunner.query(`DROP TABLE "billing_customers"`);
    await queryRunner.query(`DROP TABLE "plans"`);
  }
}
