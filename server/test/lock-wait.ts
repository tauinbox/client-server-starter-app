import type { DataSource } from 'typeorm';
import { eventually } from './eventually';

/**
 * True once `waiters` queries whose text matches `pattern` (an ILIKE pattern)
 * wait on a lock in Postgres. A test that holds a lock asserts the wait of the
 * other requests with this, in place of a fixed pause. A request that does not
 * wait makes it return false at the deadline of `eventually`.
 */
export async function waitsOnLock(
  dataSource: DataSource,
  pattern: string,
  waiters = 1
): Promise<boolean> {
  const reached = await eventually(async () => {
    const [{ waiting }] = await dataSource.query<Array<{ waiting: number }>>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE $1`,
      [pattern]
    );

    return waiting >= waiters ? true : null;
  });

  return reached === true;
}
