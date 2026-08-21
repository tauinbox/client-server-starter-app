import { DataSource } from 'typeorm';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import {
  ALLOWED_ACTION_SORT_COLUMNS,
  ALLOWED_FEATURE_FLAG_SORT_COLUMNS,
  ALLOWED_INVOICE_SORT_COLUMNS,
  ALLOWED_RESOURCE_SORT_COLUMNS,
  ALLOWED_ROLE_SORT_COLUMNS,
  ALLOWED_SUBSCRIPTION_SORT_COLUMNS,
  ALLOWED_USER_SORT_COLUMNS
} from '@app/shared/constants';
import { postgresConfig } from '../src/postgres.config';
import { Action } from '../src/modules/auth/entities/action.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { User } from '../src/modules/users/entities/user.entity';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

/**
 * Every cursor-paginated list, paired with the whitelist of columns it may be
 * sorted by. Keyset pagination carries the sort value through a cursor built
 * from a JavaScript `Date`, so a sortable timestamp column must not store
 * precision finer than a millisecond.
 */
const SORTABLE_COLUMNS: ReadonlyArray<
  readonly [EntityTarget<ObjectLiteral>, readonly string[]]
> = [
  [User, ALLOWED_USER_SORT_COLUMNS],
  [Role, ALLOWED_ROLE_SORT_COLUMNS],
  [Resource, ALLOWED_RESOURCE_SORT_COLUMNS],
  [Action, ALLOWED_ACTION_SORT_COLUMNS],
  [FeatureFlag, ALLOWED_FEATURE_FLAG_SORT_COLUMNS],
  [Invoice, ALLOWED_INVOICE_SORT_COLUMNS],
  [Subscription, ALLOWED_SUBSCRIPTION_SORT_COLUMNS]
];

runWithInfra('timestamptz instant columns (e2e)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
  }, 30000);

  afterAll(async () => {
    await ds?.destroy();
  });

  it('declares every instant column as timestamp with time zone', async () => {
    const rows: Array<{
      table_name: string;
      column_name: string;
      data_type: string;
    }> = await ds.query(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type LIKE 'timestamp%'
        ORDER BY table_name, column_name`
    );

    const naive = rows.filter(
      (r) => r.data_type !== 'timestamp with time zone'
    );
    expect(
      naive.map((r) => `${r.table_name}.${r.column_name} (${r.data_type})`)
    ).toEqual([]);

    // Sanity floor so an empty/half-migrated schema cannot pass silently.
    expect(rows.length).toBeGreaterThanOrEqual(40);
  });

  it('stores no keyset sort column finer than a millisecond', async () => {
    const rows: Array<{
      table_name: string;
      column_name: string;
      datetime_precision: number | null;
    }> = await ds.query(
      `SELECT table_name, column_name, datetime_precision
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type LIKE 'timestamp%'`
    );

    const precisionByColumn = new Map(
      rows.map((r) => [
        `${r.table_name}.${r.column_name}`,
        r.datetime_precision
      ])
    );

    const offenders: string[] = [];
    let checked = 0;

    for (const [entity, sortColumns] of SORTABLE_COLUMNS) {
      const metadata = ds.getMetadata(entity);

      for (const property of sortColumns) {
        const column = metadata.findColumnWithPropertyName(property);
        expect(column).toBeDefined();

        const key = `${metadata.tableName}.${column?.databaseName}`;
        const precision = precisionByColumn.get(key);

        // Only the timestamp sort keys are in scope; string and boolean ones
        // round-trip through the cursor exactly.
        if (precision === undefined) continue;

        checked++;
        if (precision === null || precision > 3) {
          offenders.push(`${key} (precision ${precision ?? 'unbounded'})`);
        }
      }
    }

    expect(offenders).toEqual([]);

    // Sanity floor: the seven `createdAt` defaults plus
    // `subscriptions.current_period_end`.
    expect(checked).toBe(8);
  });

  it('preserves an instant across a non-UTC session timezone', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query("SET LOCAL TIME ZONE 'America/Los_Angeles'");

      const [{ id: userId }] = (await runner.query(
        `INSERT INTO users (email, "firstName", "lastName")
         VALUES ($1, $2, $3) RETURNING id`,
        [`tsz-${Date.now()}@example.com`, 'Ts', 'Z']
      )) as Array<{ id: string }>;

      const instant = new Date('2026-07-01T05:30:00.000Z');
      await runner.query(
        `INSERT INTO refresh_tokens (token, user_id, expires_at)
         VALUES ($1, $2, $3)`,
        [`tsz-token-${Date.now()}`, userId, instant]
      );

      const [{ expires_at: storedExpiresAt }] = (await runner.query(
        `SELECT expires_at FROM refresh_tokens WHERE user_id = $1`,
        [userId]
      )) as Array<{ expires_at: Date }>;

      expect(new Date(storedExpiresAt).getTime()).toBe(instant.getTime());
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
