/**
 * Every node of a pool keeps its shared state in the Redis of the pool: the
 * single-use ledgers, the failed-attempt windows, the cache versions, the rate
 * limits and the SSE registry. Without Redis each process keeps its own copy,
 * so a single-use proof can be spent once on each node. A production process
 * therefore refuses to start without `REDIS_URL`.
 *
 * The check is not in the config schema: the server e2e boots test apps in
 * production mode with no Redis, and a test app does not run `main.ts`.
 */
export function assertProductionRedis({
  environment,
  redisUrl
}: {
  environment: string | undefined;
  redisUrl: string | undefined;
}): void {
  if (environment === 'production' && !redisUrl) {
    throw new Error(
      'REDIS_URL is not set: a production node keeps its shared state in Redis and refuses to start without it'
    );
  }
}
