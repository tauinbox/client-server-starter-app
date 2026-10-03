import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { RenameBillingProviderFlagKeys1785500000000 } from '../src/migrations/1785500000000-rename-billing-provider-flag-keys';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const OLD_KEYS = [
  'billing.provider.paddle.enabled',
  'billing.provider.yookassa.enabled'
];
const NEW_KEYS = ['billing-paddle', 'billing-yookassa'];

runWithInfra('rename billing provider flag keys migration (e2e)', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  const migration = new RenameBillingProviderFlagKeys1785500000000();

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
  }, 30000);

  afterAll(async () => {
    await ds?.destroy();
  });

  // Every case runs inside a transaction that is rolled back, so the shared
  // database keeps the rows the migration chain left there.
  beforeEach(async () => {
    qr = ds.createQueryRunner();
    await qr.startTransaction();
    await qr.query(`DELETE FROM "feature_flags" WHERE "key" = ANY($1)`, [
      [...OLD_KEYS, ...NEW_KEYS]
    ]);
  });

  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  async function insert(key: string): Promise<void> {
    await qr.query(
      `INSERT INTO "feature_flags" ("key", "enabled", "environments", "public", "version")
       VALUES ($1, true, '{production}', false, 1)`,
      [key]
    );
  }

  type FlagRow = { key: string; version: number; enabled: boolean };

  function rows(): Promise<FlagRow[]> {
    return qr.manager.query<FlagRow[]>(
      `SELECT "key", "version", "enabled" FROM "feature_flags"
        WHERE "key" = ANY($1) ORDER BY "key"`,
      [[...OLD_KEYS, ...NEW_KEYS]]
    );
  }

  it('renames both rows, keeps their state and is idempotent', async () => {
    for (const key of OLD_KEYS) await insert(key);

    await migration.up(qr);
    const once = await rows();
    expect(once).toEqual([
      { key: 'billing-paddle', version: 2, enabled: true },
      { key: 'billing-yookassa', version: 2, enabled: true }
    ]);

    await migration.up(qr);
    expect(await rows()).toEqual(once);
  });

  it('leaves an old row alone when the new key is already taken', async () => {
    await insert(OLD_KEYS[0]);
    await insert(NEW_KEYS[0]);

    await migration.up(qr);

    expect((await rows()).map((r) => r.key)).toEqual([
      'billing-paddle',
      'billing.provider.paddle.enabled'
    ]);
  });

  it('down restores the old keys', async () => {
    for (const key of OLD_KEYS) await insert(key);

    await migration.up(qr);
    await migration.down(qr);

    expect((await rows()).map((r) => r.key)).toEqual(OLD_KEYS);
  });
});
