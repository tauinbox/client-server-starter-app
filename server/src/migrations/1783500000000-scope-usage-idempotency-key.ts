import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeUsageIdempotencyKey1783500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // A globally unique key makes one customer's producer sequence swallow
    // another's event. Widening it needs no collision pre-flight: the dropped
    // constraint already kept every key unique table-wide.
    await queryRunner.query(`
      ALTER TABLE "billing_usage_records"
      DROP CONSTRAINT "UQ_billing_usage_records_idempotency_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_usage_records"
      ADD CONSTRAINT "UQ_billing_usage_records_customer_idempotency_key"
      UNIQUE ("customer_id", "idempotency_key")
    `);

    // The unique constraint's index leads with customer_id, so it already
    // serves the cascade-delete lookup the standalone index was added for.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_billing_usage_records_customer_id"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_usage_records_customer_id"
      ON "billing_usage_records" ("customer_id")
    `);

    // Narrowing back can genuinely conflict: rows that are legitimate per
    // customer collide globally. Collapsing metering data is a human decision.
    await queryRunner.query(`
      DO $$
      DECLARE duplicates text;
      BEGIN
        SELECT string_agg(idempotency_key, ', ')
          INTO duplicates
          FROM (
            SELECT idempotency_key
              FROM "billing_usage_records"
             GROUP BY idempotency_key
            HAVING count(*) > 1
          ) d;
        IF duplicates IS NOT NULL THEN
          RAISE EXCEPTION
            'Cannot restore the global usage idempotency key: keys reused across customers (%). Resolve the collision before reverting.',
            duplicates;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_usage_records"
      DROP CONSTRAINT "UQ_billing_usage_records_customer_idempotency_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_usage_records"
      ADD CONSTRAINT "UQ_billing_usage_records_idempotency_key"
      UNIQUE ("idempotency_key")
    `);
  }
}
