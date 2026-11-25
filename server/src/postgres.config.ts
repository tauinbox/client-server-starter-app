import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataSourceOptions, LoggerOptions } from 'typeorm';
import { loadExportedClasses } from './load-exported-classes';

const ENTITY_FILE = /\.entity\.(ts|js)$/;
const MIGRATION_FILE = /^\d+-[\w-]+\.(ts|js)$/;

type PostgresConnectionOptions = Extract<
  DataSourceOptions,
  { type: 'postgres' }
>;

const localConfig: Partial<PostgresConnectionOptions> = {
  host: '',
  port: 5432,
  username: '',
  password: '',
  database: '',
  logging: ['warn', 'error'] as LoggerOptions,
  logger: 'simple-console',
  schema: 'public',
  migrationsRun: false
};

export const postgresConfig: () => PostgresConnectionOptions = () => ({
  type: 'postgres',
  host: process.env['DB_HOST'] || localConfig.host,
  port: process.env['DB_PORT']
    ? Number(process.env['DB_PORT'])
    : localConfig.port,
  username: process.env['DB_USER'] || localConfig.username,
  password: process.env['DB_PASSWORD'] || localConfig.password,
  database: process.env['DB_NAME'] || localConfig.database,
  schema: process.env['DB_SCHEMA'] || localConfig.schema,
  logging: process.env['DB_LOGGING']
    ? isJsonString(process.env['DB_LOGGING'])
      ? (JSON.parse(process.env['DB_LOGGING']) as LoggerOptions)
      : (process.env['DB_LOGGING'] as LoggerOptions)
    : localConfig.logging,
  logger:
    (process.env['DB_LOGGER'] as PostgresConnectionOptions['logger']) ||
    localConfig.logger,
  maxQueryExecutionTime: process.env['DB_SLOW_QUERY_THRESHOLD']
    ? Number(process.env['DB_SLOW_QUERY_THRESHOLD'])
    : undefined,
  migrationsRun: false, // automatically run migrations on startup
  synchronize: false, // always false — run 'npm run build && npm run migrations:run' manually
  entities: loadEntities(),
  migrations: regionalMigrations(),
  applicationName: 'Starter Project'
});

/**
 * The migrations of the regional data source: the frozen history in
 * `migrations/` (written while one database held every table), then
 * `migrations/regional/`.
 */
export function regionalMigrations(): NewableFunction[] {
  return [...loadMigrations(''), ...loadMigrations('regional')];
}

/** The migrations of the settings data source, `migrations/settings/`. */
export function settingsMigrations(): NewableFunction[] {
  return loadMigrations('settings');
}

// The build has no folder for a set with no migration yet. The file name
// pattern has no folder part, so the top level does not load a subfolder.
function loadMigrations(subdir: string): NewableFunction[] {
  const dir = join(__dirname, 'migrations', subdir);

  return existsSync(dir) ? loadExportedClasses(dir, MIGRATION_FILE) : [];
}

/** Every entity class of `modules/`, of both data sources. */
export function loadEntities(): NewableFunction[] {
  return loadExportedClasses(join(__dirname, 'modules'), ENTITY_FILE);
}

function isJsonString(str: string) {
  try {
    JSON.parse(str);
  } catch (_e) {
    return false;
  }

  return true;
}
