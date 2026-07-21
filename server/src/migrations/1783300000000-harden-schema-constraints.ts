import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenSchemaConstraints1783300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Unindexed ON DELETE CASCADE columns: every parent delete sequentially
    // scans the child table to find the rows to cascade into.
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_usage_records_customer_id"
      ON "billing_usage_records" ("customer_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_oauth_accounts_user_id"
      ON "oauth_accounts" ("user_id")
    `);

    // Composite, not status-only: the reconciliation sweep filters on
    // status = 'received' AND received_at < cutoff.
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_webhook_events_status_received_at"
      ON "billing_webhook_events" ("status", "received_at")
    `);

    // Two resources sharing a subject make CASL permission resolution ambiguous.
    // Subjects only enter this table from @RegisterResource (not admin-editable),
    // so a duplicate is a code-level collision whose merge is a human decision -
    // hence an actionable abort rather than an automatic dedupe.
    await queryRunner.query(`
      DO $$
      DECLARE duplicates text;
      BEGIN
        SELECT string_agg(subject, ', ')
          INTO duplicates
          FROM (
            SELECT subject FROM "resources" GROUP BY subject HAVING count(*) > 1
          ) d;
        IF duplicates IS NOT NULL THEN
          RAISE EXCEPTION
            'Cannot add UQ_resources_subject: duplicate CASL subjects present (%). Resolve the collision before migrating.',
            duplicates;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "resources"
      ADD CONSTRAINT "UQ_resources_subject" UNIQUE ("subject")
    `);

    // Tokens are hashes of random secrets, so equal hashes are duplicated rows
    // rather than a real conflict - interchangeable sessions, safe to collapse.
    await queryRunner.query(`
      DELETE FROM "refresh_tokens" t
      USING (
        SELECT id,
               row_number() OVER (PARTITION BY token ORDER BY created_at DESC, id) AS rn
          FROM "refresh_tokens"
      ) d
      WHERE t.id = d.id AND d.rn > 1
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_tokens_token"`);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD CONSTRAINT "UQ_refresh_tokens_token" UNIQUE ("token")
    `);

    // Both writers demote the current default before inserting the new one
    // inside a transaction, so no legitimate flow holds two defaults.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_billing_payment_methods_customer_default"
      ON "billing_payment_methods" ("customer_id")
      WHERE "is_default"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_billing_payment_methods_customer_default"`
    );

    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "UQ_refresh_tokens_token"`
    );
    await queryRunner.query(`
      CREATE INDEX "idx_refresh_tokens_token" ON "refresh_tokens" ("token")
    `);

    await queryRunner.query(
      `ALTER TABLE "resources" DROP CONSTRAINT "UQ_resources_subject"`
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_billing_webhook_events_status_received_at"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_oauth_accounts_user_id"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_billing_usage_records_customer_id"`
    );
  }
}
