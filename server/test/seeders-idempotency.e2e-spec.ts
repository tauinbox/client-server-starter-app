import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import RbacSeeder from '../src/seeders/rbac.seeder';
import FeatureFlagsSeeder from '../src/seeders/feature-flags.seeder';
import BillingPlansSeeder from '../src/seeders/billing-plans.seeder';
import BillingProductsSeeder from '../src/seeders/billing-products.seeder';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { Action } from '../src/modules/auth/entities/action.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRule } from '../src/modules/feature-flags/entities/feature-flag-rule.entity';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

// Own schema, built by synchronize: the seeders write the canonical rows, which
// would collide with whatever the shared e2e schema holds.
const SCHEMA = 'seeder_idempotency_e2e';

const seeders = () => [
  new RbacSeeder(),
  new FeatureFlagsSeeder(),
  new BillingPlansSeeder(),
  new BillingProductsSeeder()
];

runWithInfra('seeder idempotency (e2e)', () => {
  let ds: DataSource;

  const withAdminConnection = async (statements: string[]) => {
    const admin = new DataSource({ ...postgresConfig(), logging: false });
    await admin.initialize();
    try {
      for (const statement of statements) await admin.query(statement);
    } finally {
      await admin.destroy();
    }
  };

  const dropSchema = () =>
    withAdminConnection([`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`]);

  const counts = async () => ({
    resources: await ds.getRepository(Resource).count(),
    actions: await ds.getRepository(Action).count(),
    roles: await ds.getRepository(Role).count(),
    permissions: await ds.getRepository(Permission).count(),
    rolePermissions: await ds.getRepository(RolePermission).count(),
    flags: await ds.getRepository(FeatureFlag).count(),
    flagRules: await ds.getRepository(FeatureFlagRule).count()
  });

  beforeAll(async () => {
    await withAdminConnection([
      `DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`,
      `CREATE SCHEMA "${SCHEMA}"`
    ]);
    ds = new DataSource({
      ...postgresConfig(),
      schema: SCHEMA,
      synchronize: true,
      logging: false
    });
    await ds.initialize();
  }, 60000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    await dropSchema();
  });

  it('leaves the database unchanged when re-run', async () => {
    for (const seeder of seeders()) await seeder.run(ds);
    const afterFirstRun = await counts();

    // Sanity floor so an empty run cannot pass silently.
    expect(afterFirstRun.resources).toBeGreaterThan(0);
    expect(afterFirstRun.permissions).toBe(
      afterFirstRun.resources * afterFirstRun.actions
    );
    expect(afterFirstRun.flagRules).toBeGreaterThan(0);

    for (const seeder of seeders()) await seeder.run(ds);

    expect(await counts()).toEqual(afterFirstRun);
  }, 60000);

  it('completes the seed when only part of it is already stored', async () => {
    // Resources and roles survive; everything hanging off the actions and the
    // flags goes, leaving a half-seeded database.
    await ds.query(
      `TRUNCATE "${SCHEMA}"."actions", "${SCHEMA}"."feature_flags" CASCADE`
    );

    for (const seeder of seeders()) await seeder.run(ds);

    const restored = await counts();
    expect(restored.actions).toBeGreaterThan(0);
    expect(restored.permissions).toBe(restored.resources * restored.actions);
    expect(restored.flagRules).toBeGreaterThan(0);
  }, 60000);
});
