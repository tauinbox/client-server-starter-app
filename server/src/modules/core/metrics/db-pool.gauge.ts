import { Gauge, register } from 'prom-client';

export const DB_POOL_METRIC_NAME = 'db_pool_connections';

// The pg Pool exposes these counters as getters (node_modules/pg-pool).
// TypeORM types PostgresDriver.master as `any`, so we read it structurally.
interface PgPoolCounters {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

// `driver` is `unknown` (not `{ master?: unknown }`) so a full TypeORM
// `DataSource` — whose `driver: Driver` has no `master` in its public type —
// is assignable without a cast at the call site.
interface PoolHost {
  driver?: unknown;
}

export interface DbPoolCounts {
  total: number;
  idle: number;
  waiting: number;
}

function isPgPool(pool: unknown): pool is PgPoolCounters {
  return (
    typeof pool === 'object' &&
    pool !== null &&
    typeof (pool as PgPoolCounters).totalCount === 'number' &&
    typeof (pool as PgPoolCounters).idleCount === 'number' &&
    typeof (pool as PgPoolCounters).waitingCount === 'number'
  );
}

// Returns the current pool counts, or null when the pool is not yet
// initialized or the driver is not pg (e.g. during early bootstrap).
export function readDbPoolCounts(
  source: PoolHost | undefined
): DbPoolCounts | null {
  const driver = source?.driver;
  const pool =
    typeof driver === 'object' && driver !== null
      ? (driver as { master?: unknown }).master
      : undefined;
  if (!isPgPool(pool)) {
    return null;
  }
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  };
}

export function createDbPoolGauge(source: PoolHost): Gauge<string> {
  // Re-use the existing metric if already registered (multiple module
  // initializations in the same process during E2E tests or hot-reload).
  const existing = register.getSingleMetric(DB_POOL_METRIC_NAME);
  if (existing) {
    return existing as Gauge<string>;
  }
  return new Gauge<string>({
    name: DB_POOL_METRIC_NAME,
    help: 'PostgreSQL connection-pool size by state',
    labelNames: ['state'],
    collect() {
      const counts = readDbPoolCounts(source);
      if (!counts) {
        return;
      }
      this.set({ state: 'total' }, counts.total);
      this.set({ state: 'idle' }, counts.idle);
      this.set({ state: 'waiting' }, counts.waiting);
    }
  });
}
