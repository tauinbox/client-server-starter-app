import { addInterval, nextPeriodEnd } from '../utils/period';

/**
 * The mock's boundary maths must produce the same billing day as the server's,
 * or an E2E run passes against a period the production scheduler would not set.
 * The expectations below are the server's `nextPeriodEnd` spec, restated.
 */
function chain(
  anchor: Date,
  interval: 'month' | 'year',
  periods: number
): string[] {
  const ends: string[] = [];
  let cursor = anchor;
  for (let i = 0; i < periods; i++) {
    cursor = nextPeriodEnd(anchor, cursor, interval);
    ends.push(cursor.toISOString().slice(0, 10));
  }
  return ends;
}

describe('nextPeriodEnd', () => {
  it('restores a 31st billing day after February', () => {
    expect(chain(new Date('2025-12-31T10:00:00Z'), 'month', 6)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30'
    ]);
  });

  it('leaves a mid-month billing day unchanged', () => {
    expect(chain(new Date('2026-01-15T10:00:00Z'), 'month', 3)).toEqual([
      '2026-02-15',
      '2026-03-15',
      '2026-04-15'
    ]);
  });

  it('restores a leap-day billing day on the next leap year', () => {
    expect(chain(new Date('2024-02-29T10:00:00Z'), 'year', 4)).toEqual([
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29'
    ]);
  });

  it('preserves the time-of-day component', () => {
    const anchor = new Date('2026-01-31T13:45:30Z');
    expect(nextPeriodEnd(anchor, anchor, 'month').toISOString()).toBe(
      '2026-02-28T13:45:30.000Z'
    );
  });

  it('diverges from chaining addInterval, which never recovers the day', () => {
    let chained = new Date('2025-12-31T10:00:00Z');
    for (let i = 0; i < 3; i++) chained = addInterval(chained, 'month');
    expect(chained.toISOString().slice(0, 10)).toBe('2026-03-28');
  });
});
