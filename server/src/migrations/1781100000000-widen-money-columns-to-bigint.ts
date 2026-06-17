import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens the overflow-prone money/quantity columns from `integer` (PG int32,
 * ceiling ~2.1e9 minor units) to `bigint`. A high-volume usage product
 * (`billableUnits * unitPriceMinor`) or a large invoice total overflows int32
 * and aborts the insert with `22003 numeric out of range`; bigint lifts the
 * ceiling to int64. Pure counters (subscription seats, dunning attempts, plan
 * trial days, webhook attempts) stay `integer`. node-pg returns `bigint` as a
 * string, decoded back to a `Money` value object by `moneyColumnTransformer`.
 */
export class WidenMoneyColumnsToBigint1781100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" ALTER COLUMN "amount_minor" TYPE bigint`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" ALTER COLUMN "refunded_minor" TYPE bigint`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_credit_balances" ALTER COLUMN "balance_units" TYPE bigint`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_credit_ledger" ALTER COLUMN "delta" TYPE bigint`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_usage_records" ALTER COLUMN "quantity" TYPE bigint`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Narrowing back to int32 fails if any row exceeds its ceiling — the cast is
    // explicit so the failure is loud rather than silent truncation.
    await queryRunner.query(
      `ALTER TABLE "billing_usage_records" ALTER COLUMN "quantity" TYPE integer USING "quantity"::integer`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_credit_ledger" ALTER COLUMN "delta" TYPE integer USING "delta"::integer`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_credit_balances" ALTER COLUMN "balance_units" TYPE integer USING "balance_units"::integer`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" ALTER COLUMN "refunded_minor" TYPE integer USING "refunded_minor"::integer`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" ALTER COLUMN "amount_minor" TYPE integer USING "amount_minor"::integer`
    );
  }
}
