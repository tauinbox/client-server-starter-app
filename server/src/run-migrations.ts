import * as dotenv from 'dotenv';
import {
  POOL_LOCK_KEYS,
  runSerializedInPool
} from './common/utils/pool-lock.util';
import { dataRegionFromEnv, withMigrationSources } from './migration-sets';
import { migrateAndReport } from './run-boot-steps';

dotenv.config();

/**
 * `npm run migrations:run`: the migration step of the boot with no admin
 * seed. It takes the lock of the boot steps, so it does not run beside a node
 * that starts.
 */
async function main(): Promise<void> {
  const region = dataRegionFromEnv();

  await withMigrationSources((sources) =>
    runSerializedInPool(sources.regional, POOL_LOCK_KEYS.bootSteps, () =>
      migrateAndReport(sources, region)
    )
  );
}

main().catch((err: unknown) => {
  console.error('Migrations failed:', err);
  process.exit(1);
});
