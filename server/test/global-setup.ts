import { assertDatabaseReachable, resolveE2eEnv } from './db-e2e-config';
import {
  flushRedisDatabase,
  readE2eRedisDb,
  readRedisUrl,
  withRedisDatabase
} from './redis-e2e-isolation';

/**
 * Resolves the database and mail settings from `.env` for anything the
 * environment does not already set, then pins the whole e2e run to a dedicated
 * Redis database and wipes it, so state written by an earlier run (throttler
 * counters above all) cannot leak into this one. Workers are forked after this
 * hook, so they inherit both; ConfigModule keeps them because process.env wins
 * over `.env`.
 *
 * No-op without Redis, which is how CI runs.
 */
export default async function globalSetup(): Promise<void> {
  Object.assign(process.env, resolveE2eEnv());

  if (process.env['DB_HOST']) {
    await assertDatabaseReachable();
  }

  const baseUrl = readRedisUrl();
  if (!baseUrl) {
    return;
  }

  const isolatedUrl = withRedisDatabase(baseUrl, readE2eRedisDb());
  process.env['REDIS_URL'] = isolatedUrl;

  try {
    await flushRedisDatabase(isolatedUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot isolate the e2e Redis database (${isolatedUrl}): ${reason}. Start Redis (server/docker-compose.yml) or run with REDIS_URL= to use the in-memory throttler.`
    );
  }
}
