import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { postgresConfig } from './postgres.config';
import { seedAdmin } from './seed-admin';
import {
  POOL_LOCK_KEYS,
  runSerializedInPool
} from './common/utils/pool-lock.util';

dotenv.config();

/**
 * The steps that a node needs before it serves: the pending migrations, then
 * the admin seed. The container entrypoint runs this file under `set -e` on
 * each start, before `main`. The nodes of a pool run the steps one at a time:
 * a node that starts second waits, then finds no pending migration and an
 * existing admin. It does not skip them, because it may not serve on an old
 * schema.
 */
export async function runBootSteps(dataSource: DataSource): Promise<void> {
  await runSerializedInPool(dataSource, POOL_LOCK_KEYS.bootSteps, async () => {
    const applied = await dataSource.runMigrations();

    console.log(
      applied.length === 0
        ? 'No migrations are pending'
        : `Applied migrations: ${applied.map(({ name }) => name).join(', ')}`
    );

    await seedAdmin(dataSource);
  });
}

async function main(): Promise<void> {
  const dataSource = new DataSource(postgresConfig());

  await dataSource.initialize();

  try {
    await runBootSteps(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('Boot steps failed:', err);
    process.exit(1);
  });
}
