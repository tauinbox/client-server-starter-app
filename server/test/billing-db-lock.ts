import type { DataSource } from 'typeorm';

/**
 * The real-PostgreSQL billing suites share one database, and jest runs suites
 * in parallel workers. `RenewalService.runDueRenewals` charges every due
 * self-managed subscription in the table, so a scan in one suite charged a row
 * that another suite had seeded. Each suite that writes a self-managed
 * (`lifecycleOwner: 'self'`) subscription or runs the scan holds this lock
 * from its seed to its cleanup; the other e2e suites stay parallel.
 */
const BILLING_DB_LOCK_KEY = 482_190_001;

/**
 * A suite waits for the others that hold the lock, which run for under 40 s
 * in total on a developer machine, so its `beforeAll` needs more than the
 * default 30 s.
 */
export const BILLING_DB_LOCK_TIMEOUT_MS = 180_000;

/**
 * Takes the lock on a connection of its own, which the suite keeps until the
 * returned function releases it. Call the release before `ds.destroy()`.
 */
export async function holdBillingDbLock(
  ds: DataSource
): Promise<() => Promise<void>> {
  const runner = ds.createQueryRunner();
  await runner.connect();
  await runner.query('SELECT pg_advisory_lock($1)', [BILLING_DB_LOCK_KEY]);
  return async () => {
    await runner.query('SELECT pg_advisory_unlock($1)', [BILLING_DB_LOCK_KEY]);
    await runner.release();
  };
}
