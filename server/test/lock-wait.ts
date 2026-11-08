import type { DataSource } from 'typeorm';

/**
 * True once a query whose text matches `pattern` (an ILIKE pattern) waits on a
 * lock in Postgres. A test that holds a lock asserts the wait of the other
 * request with this, in place of a fixed pause. The deadline only stops a
 * hang: a request that does not wait returns false.
 */
export async function waitsOnLock(
  dataSource: DataSource,
  pattern: string
): Promise<boolean> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const rows: unknown[] = await dataSource.query(
      `SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE $1`,
      [pattern]
    );

    if (rows.length > 0) return true;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return false;
}
