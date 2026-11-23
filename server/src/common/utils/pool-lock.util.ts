import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

/**
 * The advisory lock keys of the jobs that write shared data. One closed list,
 * so two jobs cannot take one key by accident.
 */
export const POOL_LOCK_KEYS = {
  bootSteps: 'nexus:boot-steps',
  resourceSync: 'nexus:resource-sync',
  auditLogCleanup: 'nexus:audit-log-cleanup',
  refreshTokenCleanup: 'nexus:refresh-token-cleanup'
} as const;

export type PoolLockKey = (typeof POOL_LOCK_KEYS)[keyof typeof POOL_LOCK_KEYS];

const logger = new Logger('PoolLock');

/*
 * Both helpers hold a transaction advisory lock on one connection of the pool
 * while `job` runs on its own connections, so the job keeps its own
 * transactions. Postgres frees the lock when that transaction ends, also when
 * the node dies. Postgres holds the lock, so the same path works with and
 * without Redis, and through a pooler in transaction mode.
 */

/**
 * Runs `job` on one node of the pool. A node that finds the lock taken skips
 * the job and resolves false. For a job that a skip makes late, not wrong:
 * a scheduled cleanup.
 */
export async function runOncePerPool(
  dataSource: DataSource,
  key: PoolLockKey,
  job: () => Promise<void>
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

    await job();

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
  job: () => Promise<T>
): Promise<T> {
  return dataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);

    return job();
  });
}
