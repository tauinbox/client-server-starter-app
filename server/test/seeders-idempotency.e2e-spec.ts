import { DataSource } from 'typeorm';
import { DATA_REGIONS, HOME_DATA_REGION } from '@app/shared/constants';
import { SETTINGS_SCHEMA } from '../src/database-roles';
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

// Own database, built by synchronize: the seeders write the canonical rows,
// which would collide with whatever the shared e2e database holds. A schema
// of its own is not enough: the settings entities name the settings schema,
// so synchronize would change the settings tables of the shared database.
const DATABASE = `seeder_idempotency_e2e_${process.pid}`;

const seeders = () => [
  new RbacSeeder(),
  new FeatureFlagsSeeder(),
  new BillingPlansSeeder(),
  new BillingProductsSeeder()
];

runWithInfra('seeder idempotency (e2e)', () => {
  const ENV = process.env;
  let ds: DataSource;

  const withAdminConnection = async (
    statements: string[],
    database?: string
  ) => {
    const admin = new DataSource({
      ...postgresConfig(),
      ...(database && { database }),
      logging: false
    });

    await admin.initialize();

    try {
      for (const statement of statements) await admin.query(statement);
    } finally {
      await admin.destroy();
    }
  };

  const dropDatabase = () =>
    withAdminConnection([`DROP DATABASE IF EXISTS "${DATABASE}"`]);

  const counts = async () => ({
    resources: await ds.getRepository(Resource).count(),
    actions: await ds.getRepository(Action).count(),
    roles: await ds.getRepository(Role).count(),
    permissions: await ds.getRepository(Permission).count(),
    rolePermissions: await ds.getRepository(RolePermission).count(),
    flags: await ds.getRepository(FeatureFlag).count(),
    flagRules: await ds.getRepository(FeatureFlagRule).count(),
    declaredPairs: (await ds.getRepository(Resource).find()).reduce(
      (total, resource) => total + resource.actionNames.length,
      0
    )
  });

  beforeAll(async () => {
    process.env = { ...ENV, DATA_REGION: HOME_DATA_REGION };
    await dropDatabase();
    await withAdminConnection([`CREATE DATABASE "${DATABASE}"`]);
    await withAdminConnection(
      [
        `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
        `CREATE SCHEMA "${SETTINGS_SCHEMA}"`
      ],
      DATABASE
    );
    ds = new DataSource({
      ...postgresConfig(),
      database: DATABASE,
      // eslint-disable-next-line no-restricted-syntax -- runs on DATABASE, a database of this suite only
      synchronize: true,
      logging: false
    });
    await ds.initialize();
  }, 60000);

  afterAll(async () => {
    process.env = ENV;

    if (ds?.isInitialized) await ds.destroy();

    await dropDatabase();
  });

  it('writes nothing on a pool that does not write the settings', async () => {
    const otherRegion = DATA_REGIONS.find(
      (region) => region !== HOME_DATA_REGION
    );
    const before = await counts();

    process.env = { ...ENV, DATA_REGION: otherRegion };

    try {
      for (const seeder of seeders()) {
        await expect(seeder.run(ds)).rejects.toThrow(
          `Settings are written only on the ${HOME_DATA_REGION} pool`
        );
      }
    } finally {
      process.env = { ...ENV, DATA_REGION: HOME_DATA_REGION };
    }

    expect(await counts()).toEqual(before);
  });

  it('leaves the database unchanged when re-run', async () => {
    for (const seeder of seeders()) await seeder.run(ds);

    const afterFirstRun = await counts();

    // Sanity floor so an empty run cannot pass silently: the seed writes
    // one permission per declared pair, and the schema holds no migration
    // rows, so every pair comes from the controller declarations.
    expect(afterFirstRun.resources).toBeGreaterThan(0);
    expect(afterFirstRun.actions).toBeGreaterThan(0);
    expect(afterFirstRun.declaredPairs).toBeGreaterThan(0);
    expect(afterFirstRun.permissions).toBe(afterFirstRun.declaredPairs);
    expect(afterFirstRun.flagRules).toBeGreaterThan(0);

    for (const seeder of seeders()) await seeder.run(ds);

    expect(await counts()).toEqual(afterFirstRun);
  }, 60000);

  it('completes the seed when only part of it is already stored', async () => {
    // Resources and roles survive; everything hanging off the actions and the
    // flags goes, leaving a half-seeded database.
    await ds.query(
      `TRUNCATE "${SETTINGS_SCHEMA}"."actions", "${SETTINGS_SCHEMA}"."feature_flags" CASCADE`
    );

    for (const seeder of seeders()) await seeder.run(ds);

    const restored = await counts();

    expect(restored.actions).toBeGreaterThan(0);
    expect(restored.permissions).toBe(restored.declaredPairs);
    expect(restored.flagRules).toBeGreaterThan(0);
  }, 60000);
});
