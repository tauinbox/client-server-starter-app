import * as dotenv from 'dotenv';
import type { DataRegion } from '@app/shared/constants';
import { seedAdmin } from './seed-admin';
import {
  POOL_LOCK_KEYS,
  runSerializedInPool
} from './common/utils/pool-lock.util';
import {
  dataRegionFromEnv,
  runMigrationSets,
  withMigrationSources,
  type MigrationSources
} from './migration-sets';

dotenv.config();

/**
 * The steps that a node needs before it serves: the pending migrations of
 * both sets, the check of the settings schema, then the admin seed. The
 * container entrypoint runs this file under `set -e` on each start, before
 * `main`. The nodes of a pool run the steps one at a time: a node that starts
 * second waits, then finds no pending migration and an existing admin. It
 * does not skip them, because it may not serve on an old schema.
 */
export async function runBootSteps(
  sources: MigrationSources,
  region: DataRegion
): Promise<void> {
  await runSerializedInPool(
    sources.regional,
    POOL_LOCK_KEYS.bootSteps,
    async () => {
      await migrateAndReport(sources, region);
      await seedAdmin(sources.regional);
    }
  );
}

/** The migration step of the boot, also run by `npm run migrations:run`. */
export async function migrateAndReport(
  sources: MigrationSources,
  region: DataRegion
): Promise<void> {
  const applied = await runMigrationSets(sources, region);

  console.log(
    applied.length === 0
      ? 'No migrations are pending'
      : `Applied migrations: ${applied.join(', ')}`
  );
}

async function main(): Promise<void> {
  const region = dataRegionFromEnv();

  await withMigrationSources((sources) => runBootSteps(sources, region));
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('Boot steps failed:', err);
    process.exit(1);
  });
}
