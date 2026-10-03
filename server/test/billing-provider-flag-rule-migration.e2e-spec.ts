import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { AddBillingProviderFlagConfiguredRule1785600000000 } from '../src/migrations/1785600000000-add-billing-provider-flag-configured-rule';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const KEYS = ['billing-paddle', 'billing-yookassa'];

const configuredRule = (customKey: string) => ({
  type: 'attribute',
  field: 'custom',
  op: 'eq',
  value: true,
  customKey
});

runWithInfra('billing provider flag configured-rule migration (e2e)', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  const migration = new AddBillingProviderFlagConfiguredRule1785600000000();

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
    await qr.query(`DELETE FROM "feature_flags" WHERE "key" = ANY($1)`, [KEYS]);
  });

  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  async function insert(key: string): Promise<string> {
    const [row] = await qr.manager.query<{ id: string }[]>(
      `INSERT INTO "feature_flags" ("key", "enabled", "environments", "public", "version")
       VALUES ($1, true, '{}', false, 1) RETURNING "id"`,
      [key]
    );
    return row.id;
  }

  type FlagState = { key: string; version: number; payloads: unknown[] };

  async function state(): Promise<FlagState[]> {
    const rows = await qr.manager.query<
      { key: string; version: number; payload: unknown }[]
    >(
      `SELECT f."key", f."version", r."payload"
         FROM "feature_flags" f
         LEFT JOIN "feature_flag_rules" r ON r."flag_id" = f."id"
        WHERE f."key" = ANY($1)
        ORDER BY f."key", r."created_at"`,
      [KEYS]
    );
    const byKey = new Map<string, FlagState>();
    for (const { key, version, payload } of rows) {
      const entry = byKey.get(key) ?? { key, version, payloads: [] };
      if (payload !== null) entry.payloads.push(payload);
      byKey.set(key, entry);
    }
    return [...byKey.values()];
  }

  it('adds the configured rule to both rows and is idempotent', async () => {
    for (const key of KEYS) await insert(key);

    await migration.up(qr);
    const once = await state();
    expect(once).toEqual([
      {
        key: 'billing-paddle',
        version: 2,
        payloads: [configuredRule('paddleConfigured')]
      },
      {
        key: 'billing-yookassa',
        version: 2,
        payloads: [configuredRule('yookassaConfigured')]
      }
    ]);

    await migration.up(qr);
    expect(await state()).toEqual(once);
  });

  it('leaves a row that already has a rule alone', async () => {
    const id = await insert('billing-paddle');
    const roleRule = { type: 'role', roleNames: ['admin'] };
    await qr.query(
      `INSERT INTO "feature_flag_rules" ("flag_id", "type", "effect", "payload")
       VALUES ($1, 'role', 'include', $2::jsonb)`,
      [id, JSON.stringify(roleRule)]
    );

    await migration.up(qr);

    expect(await state()).toEqual([
      { key: 'billing-paddle', version: 1, payloads: [roleRule] }
    ]);
  });

  it('down removes only the configured rule', async () => {
    for (const key of KEYS) await insert(key);

    await migration.up(qr);
    await migration.down(qr);

    expect(await state()).toEqual([
      { key: 'billing-paddle', version: 3, payloads: [] },
      { key: 'billing-yookassa', version: 3, payloads: [] }
    ]);
  });
});
