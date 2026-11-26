import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';

/** The iteration count of Postgres (`scram_iterations`, default 4096). */
const SCRAM_ITERATIONS = 4096;

/**
 * The SCRAM-SHA-256 verifier of `password` in the form that Postgres stores
 * (RFC 5802, RFC 7677): `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`.
 * Postgres takes a verifier in `ALTER ROLE ... PASSWORD` as it is. The
 * password is used as UTF-8 with no SASLprep, as Postgres does for a password
 * that SASLprep leaves unchanged (any ASCII password).
 */
export function scramVerifier(
  password: string,
  salt: Buffer = randomBytes(16)
): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();

  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/**
 * The schema of the settings tables. The regional tables stay in the schema
 * of the regional data source (`DB_SCHEMA`, by default `public`).
 */
export const SETTINGS_SCHEMA = 'settings';

/** The schema of the regional data source when `DB_SCHEMA` is not set. */
export const DEFAULT_REGIONAL_SCHEMA = 'public';

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

  return ('schema' in options && options.schema) || DEFAULT_REGIONAL_SCHEMA;
}

/**
 * Creates the settings schema before the migrations: TypeORM creates the
 * migrations table of the settings set in it, and creates no schema.
 */
export async function createSettingsSchema(
  settings: DataSource
): Promise<void> {
  await settings.query(`CREATE SCHEMA IF NOT EXISTS "${SETTINGS_SCHEMA}"`);
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
    // Only the SCRAM verifier leaves the process: a statement that a log
    // writes with its parameters holds no password that signs in.
    await manager.query(`SELECT set_config('app.role_verifier', $1, true)`, [
      scramVerifier(password)
    ]);
    await manager.query(
      `DO $$ BEGIN
        EXECUTE format(
          'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
          '${role}', current_setting('app.role_verifier'));
        EXECUTE format('ALTER ROLE %I IN DATABASE %I SET search_path = %I',
          '${role}', current_database(), '${schema}');
      END $$`
    );

    // The other schema is absent when the settings have a database of their
    // own: then this database holds nothing of the other source to revoke.
    const [{ found }] = await manager.query<Array<{ found: string | null }>>(
      'SELECT to_regnamespace($1) AS "found"',
      [otherSchema]
    );
    const revokes = found
      ? [
          `REVOKE ALL ON ALL TABLES IN SCHEMA ${other} FROM "${role}"`,
          `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${other} FROM "${role}"`,
          `REVOKE ALL ON SCHEMA ${other} FROM "${role}"`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${other} REVOKE ALL ON TABLES FROM "${role}"`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${other} REVOKE ALL ON SEQUENCES FROM "${role}"`
        ]
      : [];

    for (const statement of [
      ...revokes,
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
