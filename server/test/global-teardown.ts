import { flushRedisDatabase, readRedisUrl } from './redis-e2e-isolation';

/**
 * Leaves the dedicated database empty. The run is already protected by the
 * flush in global-setup, so a failure here is reported and never fails a
 * passing suite.
 */
export default async function globalTeardown(): Promise<void> {
  const isolatedUrl = readRedisUrl();
  if (!isolatedUrl) {
    return;
  }

  try {
    await flushRedisDatabase(isolatedUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Could not flush the e2e Redis database: ${reason}`);
  }
}
