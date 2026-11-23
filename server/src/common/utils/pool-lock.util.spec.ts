import { poolLockDataSource } from '../testing/pool-lock.mock';
import {
  POOL_LOCK_KEYS,
  runOncePerPool,
  runSerializedInPool
} from './pool-lock.util';

describe('runOncePerPool', () => {
  it('runs the job when this node gets the lock', async () => {
    const dataSource = poolLockDataSource(true);
    const job = jest.fn().mockResolvedValue(undefined);

    const ran = await runOncePerPool(
      // @ts-expect-error - partial DataSource stub: transaction and query only
      dataSource,
      POOL_LOCK_KEYS.auditLogCleanup,
      job
    );

    expect(ran).toBe(true);
    expect(job).toHaveBeenCalledTimes(1);
    expect(dataSource.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
      [POOL_LOCK_KEYS.auditLogCleanup]
    );
  });

  it('skips the job when another node holds the lock', async () => {
    const dataSource = poolLockDataSource(false);
    const job = jest.fn().mockResolvedValue(undefined);

    const ran = await runOncePerPool(
      // @ts-expect-error - partial DataSource stub: transaction and query only
      dataSource,
      POOL_LOCK_KEYS.auditLogCleanup,
      job
    );

    expect(ran).toBe(false);
    expect(job).not.toHaveBeenCalled();
  });
});

describe('runSerializedInPool', () => {
  it('waits for the lock, then returns the result of the job', async () => {
    const dataSource = poolLockDataSource();

    const result = await runSerializedInPool(
      // @ts-expect-error - partial DataSource stub: transaction and query only
      dataSource,
      POOL_LOCK_KEYS.bootSteps,
      () => Promise.resolve('done')
    );

    expect(result).toBe('done');
    expect(dataSource.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [POOL_LOCK_KEYS.bootSteps]
    );
  });
});
