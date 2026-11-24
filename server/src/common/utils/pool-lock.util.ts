import { Logger } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

/**
 * The advisory lock keys of the jobs that write shared data. One closed list,
 * so two jobs cannot take one key by accident.
 */
export const POOL_LOCK_KEYS = {
  bootSteps: 'nexus:boot-steps',
  resourceSync: 'nexus:resource-sync',
  auditLogCleanup: 'nexus:audit-log-cleanup',
  refreshTokenCleanup: 'nexus:refresh-token-cleanup',
  settingsChangeApply: 'nexus:settings-change-apply',
  settingsChangeLogCleanup: 'nexus:settings-change-log-cleanup'
} as const;

export type PoolLockKey = (typeof POOL_LOCK_KEYS)[keyof typeof POOL_LOCK_KEYS];

/**
 * The longest wait for a serialized lock, for a lock that a request waits for:
 * past it the call fails instead of holding its connection. A key with no
 * entry waits until the holder ends (a boot step).
 */
const POOL_LOCK_WAIT_MS: Partial<Record<PoolLockKey, number>> = {
  [POOL_LOCK_KEYS.settingsChangeApply]: 10_000
};

const logger = new Logger('PoolLock');

/*
 * Both helpers hold a transaction advisory lock on one connection of the pool.
 * `job` gets the manager of that transaction: a job that uses it needs no
 * second connection, so waiters that hold the other connections cannot starve
 * it. A job that runs its own transactions ignores it. Postgres frees the lock
 * when that transaction ends, also when the node dies. Postgres holds the
 * lock, so the same path works with and without Redis, and through a pooler in
 * transaction mode.
 */

/**
 * Runs `job` on one node of the pool. A node that finds the lock taken skips
 * the job and resolves false. For a job that a skip makes late, not wrong:
 * a scheduled cleanup.
 */
export async function runOncePerPool(
  dataSource: DataSource,
  key: PoolLockKey,
  job: (manager: EntityManager) => Promise<void>
): Promise<boolean> {
  return dataSource.transaction(async (manager) => {
    const [{ locked }] = await manager.query<Array<{ locked: boolean }>>(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
      [key]
    );

    if (!locked) {
      logger.debug(`Skipped "${key}": another node runs it`);

      return false;
    }

    await job(manager);

    return true;
  });
}

/**
 * Runs `job` on one node of the pool at a time. A node that finds the lock
 * taken waits, then runs the job. For a step that a node needs before it
 * serves: the migrations, the admin seed, the resource sync.
 */
export async function runSerializedInPool<T>(
  dataSource: DataSource,
  key: PoolLockKey,
  job: (manager: EntityManager) => Promise<T>
): Promise<T> {
  return dataSource.transaction(async (manager) => {
    const waitMs = POOL_LOCK_WAIT_MS[key];

    // An integer literal: SET takes no bind parameter.
    if (waitMs !== undefined) {
      await manager.query(`SET LOCAL lock_timeout = ${Math.trunc(waitMs)}`);
    }

    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);

    return job(manager);
  });
}
