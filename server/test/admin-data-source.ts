import { DataSource } from 'typeorm';
import { settingsMigrationOptions } from '../src/migration-sets';
import { postgresConfig } from '../src/postgres.config';

/** The database of a data source of the app. */
export type AdminDatabase = 'regional' | 'settings';

/**
 * The options of an administrator connection to the database of `source`.
 * The settings can have a database of their own (`SETTINGS_DB_NAME`), so a
 * test that reads or changes a settings table connects to `settings`.
 */
export function adminOptions(
  source: AdminDatabase
): ReturnType<typeof postgresConfig> {
  const options =
    source === 'settings' ? settingsMigrationOptions() : postgresConfig();

  return { ...options, migrations: [], logging: false };
}

/** An initialized administrator data source of the database of `source`; the caller destroys it. */
export async function openAdminDataSource(
  source: AdminDatabase
): Promise<DataSource> {
  const ds = new DataSource(adminOptions(source));

  await ds.initialize();

  return ds;
}

/** True when the settings are in another database than the regional tables. */
export function settingsHaveOwnDatabase(): boolean {
  const regional = adminOptions('regional');
  const settings = adminOptions('settings');

  return (
    settings.host !== regional.host ||
    settings.port !== regional.port ||
    settings.database !== regional.database
  );
}

/**
 * Runs `run` on a connection of the administrator of the e2e database of
 * `source`. The data sources of the app log in with roles that cannot change
 * the schema, so a test that creates a trigger, a schema or a probe table, or
 * that turns the triggers off as a restore does, uses this connection.
 */
export async function withAdminDataSource<T>(
  run: (admin: DataSource) => Promise<T>,
  { source }: { source: AdminDatabase }
): Promise<T> {
  const admin = new DataSource(adminOptions(source));

  await admin.initialize();

  try {
    return await run(admin);
  } finally {
    await admin.destroy();
  }
}
