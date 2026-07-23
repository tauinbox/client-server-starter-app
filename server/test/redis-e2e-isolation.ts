import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';
import Redis from 'ioredis';

/**
 * Logical database the e2e run is confined to. Throttler counters, cache
 * entries and BullMQ keys written by a run survive it (the login throttler
 * window is LOCKOUT_DURATION_MS), so repeated runs against a shared Redis
 * accumulate hits until a later run trips a 429. Confining the run to its own
 * database makes it safe to wipe that state before every run.
 */
export const DEFAULT_E2E_REDIS_DB = 15;

/**
 * Resolves the Redis URL the application under test will use. The app reads
 * `.env` through ConfigModule, so a URL that exists only in the file still
 * reaches the throttler and has to be seen here too. An explicit (even empty)
 * `REDIS_URL` in the environment wins, which keeps `REDIS_URL= npm run
 * test:e2e` running without Redis, exactly like CI.
 */
export function readRedisUrl(
  env: NodeJS.ProcessEnv = process.env,
  envFilePath = join(__dirname, '..', '.env')
): string | undefined {
  if ('REDIS_URL' in env) {
    return env['REDIS_URL'] || undefined;
  }

  try {
    return dotenv.parse(readFileSync(envFilePath))['REDIS_URL'] || undefined;
  } catch {
    return undefined;
  }
}

export function readE2eRedisDb(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['E2E_REDIS_DB'];
  if (raw === undefined || raw === '') {
    return DEFAULT_E2E_REDIS_DB;
  }
  return assertIsolatedDb(Number(raw));
}

export function withRedisDatabase(url: string, db: number): string {
  const parsed = new URL(url);
  parsed.pathname = `/${assertIsolatedDb(db)}`;
  return parsed.toString();
}

export async function flushRedisDatabase(url: string): Promise<void> {
  assertIsolatedDb(Number(new URL(url).pathname.replace(/^\/+/, '')));

  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // Without this a dead Redis is retried forever and the run hangs instead of
    // reporting why it cannot isolate itself.
    retryStrategy: () => null
  });

  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

/**
 * Database 0 is the one a developer's dev stack (BullMQ queues, cache) actually
 * uses, so it must never become the flush target.
 */
function assertIsolatedDb(db: number): number {
  if (!Number.isInteger(db) || db < 1) {
    throw new Error(
      `E2E_REDIS_DB must be an integer >= 1, received "${db}". Database 0 holds the shared dev state and is never flushed by tests.`
    );
  }
  return db;
}
