import {
  flushRedisDatabase,
  readE2eRedisDb,
  readRedisUrl,
  withRedisDatabase
} from './redis-e2e-isolation';

/**
 * Pins the whole e2e run to a dedicated Redis database and wipes it, so state
 * written by an earlier run (throttler counters above all) cannot leak into
 * this one. Workers are forked after this hook, so they inherit the rewritten
 * REDIS_URL; ConfigModule keeps it because process.env wins over `.env`.
 *
 * No-op without Redis, which is how CI runs.
 */
export default async function globalSetup(): Promise<void> {
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
