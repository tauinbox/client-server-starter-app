import { DataSource } from 'typeorm';
import {
  HOME_DATA_REGION,
  isDataRegion,
  writesSettings,
  type DataRegion
} from '@app/shared/constants';
import {
  createSettingsSchema,
  SETTINGS_SCHEMA,
  sourceSchema
} from './database-roles';
import { postgresConfig, settingsMigrations } from './postgres.config';

/**
 * The migrations table of the settings set. It is a settings table, so the
 * replica of the settings in each region also holds the version of the
 * settings schema.
 */
export const SETTINGS_MIGRATIONS_TABLE = 'settings_migrations';

/** One data source of each migration set. */
export interface MigrationSources {
  regional: DataSource;
  settings: DataSource;
}

/**
 * The options of the data source that runs the settings set, on the login of
 * the administrator. Both sets point at one database until the settings move
 * to their own database. A new settings table goes into the settings schema;
 * the regional schema stays on the path for the functions of the extensions.
 */
export function settingsMigrationOptions(): ReturnType<typeof postgresConfig> {
  const regional = postgresConfig();

  return {
    ...regional,
    schema: SETTINGS_SCHEMA,
    entities: [],
    migrations: settingsMigrations(),
    migrationsTableName: SETTINGS_MIGRATIONS_TABLE,
    extra: {
      options: `-c search_path=${SETTINGS_SCHEMA},${regional.schema}`
    }
  };
}

/** The region of this pool, from DATA_REGION. A missing value stops the step. */
export function dataRegionFromEnv(env = process.env): DataRegion {
  const region = env['DATA_REGION'];

  if (!isDataRegion(region)) {
    throw new Error(
      `DATA_REGION must be one of the data regions, got "${region ?? ''}"`
    );
  }

  return region;
}

/**
 * A seeder writes settings rows, so only the pool of the settings primary
 * runs it. The change log carries its writes to the other pools.
 */
export function assertSettingsWriter(env = process.env): void {
  const region = dataRegionFromEnv(env);

  if (!writesSettings(region)) {
    throw new Error(
      `Settings are written only on the ${HOME_DATA_REGION} pool; this pool is ${region}`
    );
  }
}

/** The names of the migrations that the migration step ran. */
export interface MigrationSetsResult {
  applied: string[];
}

/**
 * Creates the settings schema, then runs the regional set, then the settings
 * set on the home pool only, then refuses a settings schema that is older
 * than this build. A non-home pool reads the settings schema that the home
 * pool migrated, so the home pool deploys first.
 */
export async function runMigrationSets(
  sources: MigrationSources,
  region: DataRegion
): Promise<MigrationSetsResult> {
  await createSettingsSchema(sources.settings);

  const applied = await sources.regional.runMigrations();

  if (writesSettings(region)) {
    applied.push(...(await sources.settings.runMigrations()));
  }

  await assertSettingsSchemaCurrent(sources.settings);

  return { applied: applied.map(({ name }) => name) };
}

/**
 * Throws when a settings migration of this build is not applied. A newer
 * settings schema is accepted: expand then contract keeps an older build
 * working on it. Reads only, so it runs on a read-only replica.
 */
export async function assertSettingsSchemaCurrent(
  settings: DataSource
): Promise<void> {
  const needed = settings.migrations.map(
    (migration) => migration.name ?? migration.constructor.name
  );

  if (needed.length === 0) return;

  const table = `"${sourceSchema(settings)}"."${settings.options.migrationsTableName ?? 'migrations'}"`;
  const [{ found }] = await settings.query<Array<{ found: string | null }>>(
    'SELECT to_regclass($1) AS "found"',
    [table]
  );
  const rows = found
    ? await settings.query<Array<{ name: string }>>(
        `SELECT "name" FROM ${table}`
      )
    : [];
  const applied = new Set(rows.map(({ name }) => name));
  const missing = needed.filter((name) => !applied.has(name));

  if (missing.length > 0) {
    throw new Error(
      `The settings schema is older than this build. Not applied: ${missing.join(', ')}. ` +
        `Deploy the ${HOME_DATA_REGION} pool first.`
    );
  }
}

/** Opens one data source of each set, runs `step`, then closes both. */
export async function withMigrationSources<T>(
  step: (sources: MigrationSources) => Promise<T>
): Promise<T> {
  const regional = new DataSource(postgresConfig());
  const settings = new DataSource(settingsMigrationOptions());

  await regional.initialize();

  try {
    await settings.initialize();

    try {
      return await step({ regional, settings });
    } finally {
      await settings.destroy();
    }
  } finally {
    await regional.destroy();
  }
}
