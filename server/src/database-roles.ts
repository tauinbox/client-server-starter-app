import type { DataSource } from 'typeorm';

/**
 * The schema of the settings tables. The regional tables stay in the schema
 * of the regional data source (`DB_SCHEMA`, by default `public`).
 */
export const SETTINGS_SCHEMA = 'settings';

/**
 * The schema of the frozen history of one database: the settings tables of a
 * database that it migrated are there until a settings migration moves them.
 */
export const FROZEN_HISTORY_SCHEMA = 'public';

/**
 * The database role of each data source, and the variable that holds its
 * password. Each role can read and write only the rows of its own schema, so
 * a statement that joins a regional table to a settings table fails in every
 * run, and the server process holds no password of the administrator.
 */
export const SOURCE_ROLES = {
  regional: { role: 'app_regional', passwordKey: 'DB_REGIONAL_PASSWORD' },
  settings: { role: 'app_settings', passwordKey: 'DB_SETTINGS_PASSWORD' }
} as const;

export type SourceKind = keyof typeof SOURCE_ROLES;

/** The login of the data source `kind`. A missing password stops the caller. */
export function sourceLogin(
  kind: SourceKind,
  read: (key: string) => string | undefined = (key) => process.env[key]
): { username: string; password: string } {
  const { role, passwordKey } = SOURCE_ROLES[kind];
  const password = read(passwordKey);

  if (!password) {
    throw new Error(
      `${passwordKey} must be set: it is the password of the database role ${role}`
    );
  }

  return { username: role, password };
}

/** The schema of the tables of a data source. */
export function sourceSchema(source: DataSource): string {
  const { options } = source;

  return ('schema' in options && options.schema) || FROZEN_HISTORY_SCHEMA;
}

/**
 * Creates the settings schema and moves the migrations table of the settings
 * set into it from the schema of the frozen history. It runs before the
 * migrations: TypeORM looks for that table in the schema of the data source,
 * and would run the baseline again on a database that holds it elsewhere.
 */
export async function prepareSettingsSchema(
  settings: DataSource,
  migrationsTable: string
): Promise<void> {
  await settings.query(`CREATE SCHEMA IF NOT EXISTS "${SETTINGS_SCHEMA}"`);

  const [{ move }] = await settings.query<Array<{ move: boolean }>>(
    'SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NULL AS "move"',
    [
      `"${FROZEN_HISTORY_SCHEMA}"."${migrationsTable}"`,
      `"${SETTINGS_SCHEMA}"."${migrationsTable}"`
    ]
  );

  if (move) {
    await settings.query(
      `ALTER TABLE "${FROZEN_HISTORY_SCHEMA}"."${migrationsTable}" SET SCHEMA "${SETTINGS_SCHEMA}"`
    );
  }
}

/**
 * Creates or updates the role of `kind` on the database of `source`, which
 * is connected as the administrator, after the migrations: a table that a
 * migration moved keeps the privileges of its old schema until this step
 * runs. The role gets the rows of the tables and the sequences of `schema`
 * and of no other schema; it owns no object and runs no DDL, because the
 * migrations and the seeders keep the login of the administrator.
 */
export async function grantSourceRole(
  source: DataSource,
  {
    kind,
    password,
    schema,
    otherSchema,
    migrationsTable
  }: {
    kind: SourceKind;
    password: string;
    schema: string;
    otherSchema: string;
    migrationsTable: string;
  }
): Promise<void> {
  const { role } = SOURCE_ROLES[kind];
  const own = `"${schema}"`;
  const other = `"${otherSchema}"`;

  await source.transaction(async (manager) => {
    await manager.query(
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE "${role}";
        END IF;
      END $$`
    );
    // The password goes in as a parameter, never into the text of a statement.
    await manager.query(`SELECT set_config('app.role_password', $1, true)`, [
      password
    ]);
    await manager.query(
      `DO $$ BEGIN
        EXECUTE format(
          'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
          '${role}', current_setting('app.role_password'));
        EXECUTE format('ALTER ROLE %I IN DATABASE %I SET search_path = %I',
          '${role}', current_database(), '${schema}');
      END $$`
    );
    await manager.query(`SELECT set_config('app.role_password', '', true)`);

    for (const statement of [
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${other} FROM "${role}"`,
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${other} FROM "${role}"`,
      `REVOKE ALL ON SCHEMA ${other} FROM "${role}"`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${other} REVOKE ALL ON TABLES FROM "${role}"`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${other} REVOKE ALL ON SEQUENCES FROM "${role}"`,
      `GRANT USAGE ON SCHEMA ${own} TO "${role}"`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${own} TO "${role}"`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${own} TO "${role}"`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${own} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${own} GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`,
      `REVOKE ALL ON TABLE ${own}."${migrationsTable}" FROM "${role}"`
    ]) {
      await manager.query(statement);
    }
  });
}
