import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { applyKeysetPagination } from '../src/common/utils/apply-keyset-pagination.util';
import { User } from '../src/modules/users/entities/user.entity';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

/**
 * Keyset pagination compares `(sortColumn, id)` tuples, and the cursor carries
 * the sort value through `JSON.stringify(Date)`, i.e. milliseconds. A sort
 * column able to store more precision than that names a point strictly before
 * the row the cursor was taken from: `desc` then omits rows for good and `asc`
 * repeats them, up to never advancing at all.
 *
 * The rows below are written 100 microseconds apart, which is the shape a burst
 * of concurrent inserts produces (ten rows sharing one millisecond bucket).
 * Against a `timestamptz` column this paging loses and duplicates rows; against
 * `timestamptz(3)` the sub-millisecond digits are gone before the comparison and
 * ties resolve through the `id` leg, which is what keyset pagination is for.
 */
runWithInfra('keyset pagination sort-column precision (e2e)', () => {
  const ROW_COUNT = 40;
  const PAGE_SIZE = 3;
  const emailPrefix = `keyset-precision-${Date.now()}-`;

  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();

    await ds.query(
      `INSERT INTO users (email, "firstName", "lastName", created_at)
       SELECT $1 || i || '@example.com', 'Keyset', 'Precision',
              TIMESTAMPTZ '2026-01-01 00:00:00+00' + (i * INTERVAL '100 microseconds')
         FROM generate_series(0, $2::int - 1) AS i`,
      [emailPrefix, ROW_COUNT]
    );
  }, 30000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM users WHERE email LIKE $1`, [
        `${emailPrefix}%`
      ]);
      await ds.destroy();
    }
  });

  async function expectedIds(sortOrder: 'asc' | 'desc'): Promise<string[]> {
    const direction = sortOrder.toUpperCase();
    const rows: Array<{ id: string }> = await ds.query(
      `SELECT id FROM users
        WHERE email LIKE $1
        ORDER BY created_at ${direction}, id ${direction}`,
      [`${emailPrefix}%`]
    );

    return rows.map((row) => row.id);
  }

  async function pageThrough(sortOrder: 'asc' | 'desc'): Promise<string[]> {
    const repository = ds.getRepository(User);
    const collected: string[] = [];
    // Every page must yield PAGE_SIZE new rows; anything beyond that many pages
    // means the cursor stopped advancing, which is one of the failure modes.
    const maxPages = Math.ceil(ROW_COUNT / PAGE_SIZE) + 2;

    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const qb = repository
        .createQueryBuilder('user')
        .where('user.email LIKE :prefix', { prefix: `${emailPrefix}%` });

      const result = await applyKeysetPagination(qb, {
        cursor,
        limit: PAGE_SIZE,
        sortBy: 'createdAt',
        sortOrder,
        sortColumnMap: { createdAt: 'user.createdAt' },
        idColumn: 'user.id'
      });

      collected.push(...result.data.map((user) => user.id));

      if (!result.nextCursor) {
        return collected;
      }

      cursor = result.nextCursor;
    }

    return collected;
  }

  it.each(['asc', 'desc'] as const)(
    'walks %s pages over the same rows a plain ORDER BY returns',
    async (sortOrder) => {
      const expected = await expectedIds(sortOrder);
      expect(expected).toHaveLength(ROW_COUNT);

      const paged = await pageThrough(sortOrder);

      expect(paged).toEqual(expected);
      expect(new Set(paged).size).toBe(ROW_COUNT);
    }
  );
});
