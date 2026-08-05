import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

/**
 * Settings `postgresConfig()` reads straight from `process.env`, plus the mail
 * ones the delivery suite gates on. The application picks these up from `.env`
 * through ConfigModule, but that happens inside `app.init()` - too late for a
 * suite that builds its own DataSource, and too late for the `describe`-level
 * infra gates, which are evaluated while the file is being imported.
 */
export const E2E_ENV_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DB_SCHEMA',
  'SMTP_HOST',
  'SMTP_PORT',
  'MAILPIT_URL'
] as const;

/**
 * Resolves the settings above the same way the application would: an explicit
 * environment value always wins - including an empty one, which is how a CI job
 * or a shell export stays authoritative - and anything the environment does not
 * mention is taken from `.env`.
 *
 * The merge is per key on purpose. Exporting `DB_HOST` alone used to leave the
 * credentials behind, and the run failed deep inside the pg driver
 * ("client password must be a string") rather than saying what was missing.
 */
export function resolveE2eEnv(
  env: NodeJS.ProcessEnv = process.env,
  envFilePath = join(__dirname, '..', '.env')
): Record<string, string> {
  const fromFile = parseEnvFile(envFilePath);
  const resolved: Record<string, string> = {};

  for (const key of E2E_ENV_KEYS) {
    const value = key in env ? env[key] : fromFile[key];
    if (value !== undefined) {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Opens one connection so an unreachable database is reported once, in the
 * words of the thing that is missing, instead of as a wall of driver errors in
 * every suite that needs it.
 */
export async function assertDatabaseReachable(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const host = env['DB_HOST'] as string;
  const port = Number(env['DB_PORT'] || 5432);
  const database = env['DB_NAME'] ?? '';
  const dataSource = new DataSource({
    type: 'postgres',
    host,
    port,
    username: env['DB_USER'],
    password: env['DB_PASSWORD'],
    database,
    entities: [],
    synchronize: false,
    logging: false,
    extra: { connectionTimeoutMillis: 5000 }
  });

  try {
    await dataSource.initialize();
  } catch (error) {
    const reason = describeConnectionError(error);
    throw new Error(
      `Cannot reach the e2e Postgres (${host}:${port}/${database}): ${reason}. The e2e run needs a database - start it (server/docker-compose.yml), run "npm run build && npm run migrations:run", then try again.`
    );
  } finally {
    await dataSource.destroy().catch(() => undefined);
  }
}

/**
 * A refused connection arrives as an AggregateError with an empty message and
 * one entry per address family, so the plain `.message` says nothing at all.
 */
function describeConnectionError(error: unknown): string {
  if (error instanceof AggregateError) {
    const causes = error.errors
      .map((inner: unknown) =>
        inner instanceof Error ? inner.message : String(inner)
      )
      .filter(Boolean);
    if (causes.length > 0) {
      return [...new Set(causes)].join('; ');
    }
  }

  if (error instanceof Error) {
    return error.message || (error as { code?: string }).code || error.name;
  }

  return String(error);
}

function parseEnvFile(path: string): Record<string, string> {
  try {
    return dotenv.parse(readFileSync(path));
  } catch {
    return {};
  }
}
