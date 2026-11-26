import * as dotenv from 'dotenv';
import type { DataRegion } from '@app/shared/constants';
import { seedAdmin } from './seed-admin';
import {
  POOL_LOCK_KEYS,
  runSerializedInPool
} from './common/utils/pool-lock.util';
import {
  grantSourceRole,
  SETTINGS_SCHEMA,
  sourceLogin,
  sourceSchema,
  type SourceKind
} from './database-roles';
import {
  dataRegionFromEnv,
  runMigrationSets,
  SETTINGS_MIGRATIONS_TABLE,
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

/**
 * The migration step of the boot, also run by `npm run migrations:run`: the
 * migrations, then the role of each data source. A missing role password
 * stops the step before the first migration: a rollback to the previous
 * build then finds the schema that it knows.
 */
export async function migrateAndReport(
  sources: MigrationSources,
  region: DataRegion,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const passwords = sourcePasswords(env);
  const { applied } = await runMigrationSets(sources, region);

  await grantSourceRoles(sources, passwords);

  console.log(
    applied.length === 0
      ? 'No migrations are pending'
      : `Applied migrations: ${applied.join(', ')}`
  );
}

/** The password of the role of each data source; a missing one throws. */
export function sourcePasswords(
  env: Readonly<Record<string, string | undefined>>
): Record<SourceKind, string> {
  const read = (key: string) => env[key];

  return {
    regional: sourceLogin('regional', read).password,
    settings: sourceLogin('settings', read).password
  };
}

/** Creates or updates the role of each data source on its database. */
export async function grantSourceRoles(
  sources: MigrationSources,
  passwords: Record<SourceKind, string>
): Promise<void> {
  const regionalSchema = sourceSchema(sources.regional);

  for (const [kind, source, schema, otherSchema, migrationsTable] of [
    [
      'regional',
      sources.regional,
      regionalSchema,
      SETTINGS_SCHEMA,
      'migrations'
    ],
    [
      'settings',
      sources.settings,
      SETTINGS_SCHEMA,
      regionalSchema,
      SETTINGS_MIGRATIONS_TABLE
    ]
  ] as const) {
    await grantSourceRole(source, {
      kind,
      password: passwords[kind],
      schema,
      otherSchema,
      migrationsTable
    });
  }
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
