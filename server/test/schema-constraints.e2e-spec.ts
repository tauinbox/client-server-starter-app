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
    ['billing_usage_records', 'IDX_billing_usage_records_customer_id'],
    ['oauth_accounts', 'IDX_oauth_accounts_user_id'],
    ['billing_webhook_events', 'IDX_billing_webhook_events_status_received_at'],
    ['resources', 'UQ_resources_subject'],
    ['refresh_tokens', 'UQ_refresh_tokens_token'],
    ['billing_payment_methods', 'UQ_billing_payment_methods_customer_default']
  ])('%s carries %s', async (table, index) => {
    expect(await indexNames(table)).toContain(index);
  });

  it('dropped the plain refresh-token index superseded by the unique constraint', async () => {
    expect(await indexNames('refresh_tokens')).not.toContain(
      'idx_refresh_tokens_token'
    );
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
