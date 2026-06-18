import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

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
