import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Narrows every timestamp column used as a keyset sort key to millisecond
 * precision, the precision the cursor is able to carry.
 *
 * `created_at` is filled by Postgres `now()` at microsecond precision, while the
 * cursor is built from a JavaScript `Date` and encoded with `JSON.stringify`,
 * i.e. milliseconds. The cursor therefore named a point strictly before the row
 * it was taken from, so the `(sort_column, id)` tuple comparison of the next
 * page mis-selected: `desc` dropped rows for good, `asc` returned them twice and
 * could stop advancing altogether. Storing what the transport can represent
 * makes ties resolve through the `id` leg of the tuple instead, which is what
 * keyset pagination is designed for.
 *
 * `subscriptions.current_period_end` is only ever written from a JavaScript
 * `Date`, so it holds no microseconds today; it is narrowed anyway because it is
 * a sort key, and the invariant is checked as one rule in
 * `test/instants-timestamptz.e2e-spec.ts`.
 *
 * `down()` restores the wider type but cannot restore digits this migration
 * discarded - the rounding is one-way.
 *
 * `ALTER COLUMN ... TYPE` with reduced precision rewrites the table under an
 * ACCESS EXCLUSIVE lock. All seven tables are under a megabyte in the
 * development database; the two that grow without bound are `billing_invoices`
 * and `subscriptions`, so on a large installation this is a write-blocking pause
 * rather than a metadata-only change.
 */
export class NarrowKeysetSortColumnsToMilliseconds1783900000000 implements MigrationInterface {
  private readonly columns: ReadonlyArray<readonly [string, string]> = [
    ['roles', 'created_at'],
    ['resources', 'created_at'],
    ['actions', 'created_at'],
    ['feature_flags', 'created_at'],
    ['users', 'created_at'],
    ['billing_invoices', 'created_at'],
    ['subscriptions', 'created_at'],
    ['subscriptions', 'current_period_end']
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamptz(3)`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamptz`
      );
    }
  }
}
