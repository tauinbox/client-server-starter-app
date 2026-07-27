import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('schema hardening constraints (e2e)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
  }, 30000);

  afterAll(async () => {
    await ds?.destroy();
  });

  async function indexNames(table: string): Promise<string[]> {
    const rows: Array<{ indexname: string }> = await ds.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
      [table]
    );
    return rows.map((r) => r.indexname);
  }

  it.each([
    [
      'billing_usage_records',
      'UQ_billing_usage_records_customer_idempotency_key'
    ],
    ['oauth_accounts', 'IDX_oauth_accounts_user_id'],
    ['billing_webhook_events', 'IDX_billing_webhook_events_status_received_at'],
    ['resources', 'UQ_resources_subject'],
    ['refresh_tokens', 'UQ_refresh_tokens_token'],
    ['billing_payment_methods', 'UQ_billing_payment_methods_customer_default'],
    ['users', 'UQ_users_email_lower']
  ])('%s carries %s', async (table, index) => {
    expect(await indexNames(table)).toContain(index);
  });

  it('dropped the plain refresh-token index superseded by the unique constraint', async () => {
    expect(await indexNames('refresh_tokens')).not.toContain(
      'idx_refresh_tokens_token'
    );
  });

  it('dropped the standalone usage customer index covered by the scoped unique key', async () => {
    expect(await indexNames('billing_usage_records')).not.toContain(
      'IDX_billing_usage_records_customer_id'
    );
  });

  it('accepts one usage idempotency key per customer but rejects its replay', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const stamp = Date.now();
      const subscriptionIds: string[] = [];
      const customerIds: string[] = [];

      for (const suffix of ['a', 'b']) {
        const [{ id: userId }] = (await runner.query(
          `INSERT INTO users (email, "firstName", "lastName")
           VALUES ($1, $2, $3) RETURNING id`,
          [`uq-usage-${suffix}-${stamp}@example.com`, 'Uq', 'Usage']
        )) as Array<{ id: string }>;

        const [{ id: customerId }] = (await runner.query(
          `INSERT INTO billing_customers (user_id, provider, country, currency)
           VALUES ($1, 'paddle', 'US', 'USD') RETURNING id`,
          [userId]
        )) as Array<{ id: string }>;

        const [{ id: subscriptionId }] = (await runner.query(
          `INSERT INTO subscriptions
             (customer_id, plan_key, provider, billing_mode, status,
              lifecycle_owner, current_period_start, current_period_end)
           VALUES ($1, 'usage', 'paddle', 'usage', 'active', 'provider', now(), now() + interval '30 days')
           RETURNING id`,
          [customerId]
        )) as Array<{ id: string }>;

        customerIds.push(customerId);
        subscriptionIds.push(subscriptionId);
      }

      const key = `req-${stamp}`;
      const insert = `INSERT INTO billing_usage_records
          (customer_id, subscription_id, meter_key, quantity, occurred_at, idempotency_key)
        VALUES ($1, $2, 'api_calls', 1, now(), $3)`;

      // The same producer key from two customers is two distinct events.
      await runner.query(insert, [customerIds[0], subscriptionIds[0], key]);
      await runner.query(insert, [customerIds[1], subscriptionIds[1], key]);

      await expect(
        runner.query(insert, [customerIds[0], subscriptionIds[0], key])
      ).rejects.toThrow(/UQ_billing_usage_records_customer_idempotency_key/);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('rejects a second row with the same refresh-token hash', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const [{ id: userId }] = (await runner.query(
        `INSERT INTO users (email, "firstName", "lastName")
         VALUES ($1, $2, $3) RETURNING id`,
        [`uq-token-${Date.now()}@example.com`, 'Uq', 'Token']
      )) as Array<{ id: string }>;

      const token = `uq-token-${Date.now()}`;
      const expiresAt = new Date(Date.now() + 60_000);
      const insert = `INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)`;
      await runner.query(insert, [token, userId, expiresAt]);

      await expect(
        runner.query(insert, [token, userId, expiresAt])
      ).rejects.toThrow(/UQ_refresh_tokens_token/);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('rejects a second account whose address differs only by case', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const address = `uq-case-${Date.now()}@example.com`;
      const insert = `INSERT INTO users (email, "firstName", "lastName")
         VALUES ($1, $2, $3)`;
      await runner.query(insert, [address, 'Uq', 'Case']);

      await expect(
        runner.query(insert, [address.toUpperCase(), 'Uq', 'Case'])
      ).rejects.toThrow(/UQ_users_email_lower/);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('allows many non-default payment methods but only one default per customer', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const [{ id: userId }] = (await runner.query(
        `INSERT INTO users (email, "firstName", "lastName")
         VALUES ($1, $2, $3) RETURNING id`,
        [`uq-default-${Date.now()}@example.com`, 'Uq', 'Default']
      )) as Array<{ id: string }>;

      const [{ id: customerId }] = (await runner.query(
        `INSERT INTO billing_customers (user_id, provider, country, currency)
         VALUES ($1, 'paddle', 'US', 'USD') RETURNING id`,
        [userId]
      )) as Array<{ id: string }>;

      const insert = `INSERT INTO billing_payment_methods
          (customer_id, provider, provider_method_ref, brand, last4, is_default)
        VALUES ($1, 'paddle', $2, 'visa', '4242', $3)`;

      await runner.query(insert, [customerId, 'ref-default', true]);
      await runner.query(insert, [customerId, 'ref-old-a', false]);
      await runner.query(insert, [customerId, 'ref-old-b', false]);

      await expect(
        runner.query(insert, [customerId, 'ref-second-default', true])
      ).rejects.toThrow(/UQ_billing_payment_methods_customer_default/);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
