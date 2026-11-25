import { DataSource, MigrationExecutor } from 'typeorm';
import {
  HOME_DATA_REGION,
  isDataRegion,
  writesSettings,
  type DataRegion
} from '@app/shared/constants';
import {
  BASELINE_MIGRATIONS,
  FROZEN_MIGRATIONS
} from './frozen-migration-history';
import {
  FROZEN_HISTORY_SCHEMA,
  prepareSettingsSchema,
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
 * `public` stays on the path for the functions of the extensions.
 */
export function settingsMigrationOptions(): ReturnType<typeof postgresConfig> {
  return {
    ...postgresConfig(),
    schema: SETTINGS_SCHEMA,
    entities: [],
    migrations: settingsMigrations(),
    migrationsTableName: SETTINGS_MIGRATIONS_TABLE,
    extra: {
      options: `-c search_path=${SETTINGS_SCHEMA},${FROZEN_HISTORY_SCHEMA}`
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

/** The names of the migrations that the migration step ran and recorded. */
export interface MigrationSetsResult {
  applied: string[];
  /** The baselines recorded with no run on a database of the frozen history. */
  recorded: string[];
}

/**
 * Prepares the settings schema, records the baselines, then runs the
 * regional set, then the settings set on the home pool only, then refuses a
 * settings schema that is older than this build. A non-home pool reads the
 * settings schema that the home pool migrated, so the home pool deploys
 * first.
 */
export async function runMigrationSets(
  sources: MigrationSources,
  region: DataRegion
): Promise<MigrationSetsResult> {
  await prepareSettingsSchema(sources.settings, SETTINGS_MIGRATIONS_TABLE);

  const recorded = await recordFrozenHistoryBaselines(sources, region);
  const applied = await sources.regional.runMigrations();

  if (writesSettings(region)) {
    applied.push(...(await sources.settings.runMigrations()));
  }

  await assertSettingsSchemaCurrent(sources.settings);

  return { applied: applied.map(({ name }) => name), recorded };
}

class BaselineRecorder extends MigrationExecutor {
  /**
   * Records the migration as applied with no run. Returns false when the set
   * of the data source does not hold it or it is already recorded.
   */
  async record(name: string): Promise<boolean> {
    const migration = this.getMigrations().find((m) => m.name === name);

    if (!migration) return false;

    const executed = await this.getExecutedMigrations();

    if (executed.some((m) => m.name === name)) return false;

    await this.withQueryRunner(async (queryRunner) => {
      await this.createMigrationsTableIfNotExist(queryRunner);
      await this.insertExecutedMigration(queryRunner, migration);
    });

    return true;
  }
}

/**
 * A database whose `migrations` table holds the whole frozen history has the
 * schema of the baselines (`test/migration-baseline.e2e-spec.ts`), so the
 * baselines are recorded there with no run: the regional one on every pool,
 * the settings one on the home pool. Each set is decided alone from the
 * history rows, so a step that stops between the two sets repeats safely.
 * Part of the history means a database that an older build left behind: it
 * stops the step, because the baselines would run over a partial schema.
 */
export async function recordFrozenHistoryBaselines(
  sources: MigrationSources,
  region: DataRegion
): Promise<string[]> {
  const executed = await new MigrationExecutor(
    sources.regional
  ).getExecutedMigrations();
  const history = new Set(executed.map(({ name }) => name));
  const found = FROZEN_MIGRATIONS.filter((name) => history.has(name));

  if (found.length === 0) return [];

  if (found.length < FROZEN_MIGRATIONS.length) {
    throw new Error(
      `The database holds ${found.length} of the ${FROZEN_MIGRATIONS.length} migrations of the frozen history. ` +
        'Migrate it with a build that still has them (src/migrations/1795533760005-add-settings-audit-outcome.ts), then start this build.'
    );
  }

  const sets: Array<[DataSource, string]> = [
    [sources.regional, BASELINE_MIGRATIONS.regional]
  ];

  if (writesSettings(region)) {
    sets.push([sources.settings, BASELINE_MIGRATIONS.settings]);
  }

  const recorded: string[] = [];

  for (const [source, name] of sets) {
    if (await new BaselineRecorder(source).record(name)) recorded.push(name);
  }

  return recorded;
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
