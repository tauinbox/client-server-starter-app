import { addInterval, nextPeriodEnd } from './period.util';

/** UTC [year, month-1, day] for a Date - addInterval operates on the UTC wall-clock. */
function ymd(date: Date): [number, number, number] {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

/** A Date at the given UTC wall-clock, independent of the process time zone. */
function utc(
  year: number,
  monthIndex: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0
): Date {
  return new Date(Date.UTC(year, monthIndex, day, hours, minutes, seconds));
}

describe('addInterval', () => {
  describe('month', () => {
    it('clamps Jan 31 to Feb 28 in a non-leap year (no overflow into March)', () => {
      expect(ymd(addInterval(utc(2026, 0, 31), 'month'))).toEqual([
        2026, 2, 28
      ]);
    });

    it('clamps Jan 31 to Feb 29 in a leap year', () => {
      expect(ymd(addInterval(utc(2024, 0, 31), 'month'))).toEqual([
        2024, 2, 29
      ]);
    });

    it('clamps Jan 30 to Feb 28', () => {
      expect(ymd(addInterval(utc(2026, 0, 30), 'month'))).toEqual([
        2026, 2, 28
      ]);
    });

    it('clamps a 31st anchor to a 30-day month (Mar 31 -> Apr 30)', () => {
      expect(ymd(addInterval(utc(2026, 2, 31), 'month'))).toEqual([
        2026, 4, 30
      ]);
    });

    it('leaves a mid-month anchor unchanged', () => {
      expect(ymd(addInterval(utc(2026, 2, 15), 'month'))).toEqual([
        2026, 4, 15
      ]);
    });

    it('rolls the year over from December', () => {
      expect(ymd(addInterval(utc(2026, 11, 15), 'month'))).toEqual([
        2027, 1, 15
      ]);
    });

    it('keeps a day that exists in the target month (Jan 28 -> Feb 28)', () => {
      expect(ymd(addInterval(utc(2026, 0, 28), 'month'))).toEqual([
        2026, 2, 28
      ]);
    });

    it('preserves the time-of-day component', () => {
      const result = addInterval(utc(2026, 0, 31, 13, 45, 30), 'month');
      expect([
        result.getUTCHours(),
        result.getUTCMinutes(),
        result.getUTCSeconds()
      ]).toEqual([13, 45, 30]);
    });
  });

  describe('year', () => {
    it('advances Jan 31 to Jan 31 next year (unaffected by clamping)', () => {
      expect(ymd(addInterval(utc(2026, 0, 31), 'year'))).toEqual([2027, 1, 31]);
    });

    it('clamps a Feb 29 leap-day anchor to Feb 28 the next year', () => {
      expect(ymd(addInterval(utc(2024, 1, 29), 'year'))).toEqual([2025, 2, 28]);
    });

    it('leaves a mid-year anchor unchanged', () => {
      expect(ymd(addInterval(utc(2026, 5, 15), 'year'))).toEqual([2027, 6, 15]);
    });
  });

  // The boundary must be the same instant regardless of the process time zone.
  // The previous local-time implementation produced a different result under a
  // non-UTC zone; these assertions fail against it.
  describe('time-zone independence', () => {
    const originalTz = process.env['TZ'];
    afterAll(() => {
      process.env['TZ'] = originalTz;
    });

    /** ISO of `addInterval` evaluated with the process pinned to `tz`. */
    function isoUnder(
      tz: string,
      from: Date,
      interval: 'month' | 'year'
    ): string {
      process.env['TZ'] = tz;
      return addInterval(from, interval).toISOString();
    }

    const cases: ReadonlyArray<[string, Date, 'month' | 'year', string]> = [
      [
        'month-end clamp',
        new Date('2026-01-31T00:00:00Z'),
        'month',
        '2026-02-28T00:00:00.000Z'
      ],
      [
        'leap-year clamp',
        new Date('2024-01-31T00:00:00Z'),
        'month',
        '2024-02-29T00:00:00.000Z'
      ],
      [
        '30-day target',
        new Date('2026-03-31T00:00:00Z'),
        'month',
        '2026-04-30T00:00:00.000Z'
      ],
      [
        'year leap clamp',
        new Date('2024-02-29T00:00:00Z'),
        'year',
        '2025-02-28T00:00:00.000Z'
      ],
      [
        'time-of-day preserved',
        new Date('2026-01-31T13:45:30Z'),
        'month',
        '2026-02-28T13:45:30.000Z'
      ]
    ];

    it.each(cases)(
      'gives the same UTC instant in UTC and America/New_York (%s)',
      (_label, from, interval, expected) => {
        const inUtc = isoUnder('UTC', from, interval);
        const inNewYork = isoUnder('America/New_York', from, interval);
        expect(inUtc).toBe(expected);
        expect(inNewYork).toBe(expected);
      }
    );
  });
});

describe('nextPeriodEnd', () => {
  /** The boundaries the anchor produces over `periods` consecutive renewals. */
  function chain(
    anchor: Date,
    from: Date,
    interval: 'month' | 'year',
    periods: number
  ): string[] {
    const ends: string[] = [];
    let cursor = from;
    for (let i = 0; i < periods; i++) {
      cursor = nextPeriodEnd(anchor, cursor, interval);
      ends.push(cursor.toISOString().slice(0, 10));
    }
    return ends;
  }

  it('restores a 31st billing day after February', () => {
    const anchor = utc(2025, 11, 31);
    expect(chain(anchor, anchor, 'month', 6)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30'
    ]);
  });

  it('restores a 30th billing day after February', () => {
    const anchor = utc(2026, 0, 30);
    expect(chain(anchor, anchor, 'month', 3)).toEqual([
      '2026-02-28',
      '2026-03-30',
      '2026-04-30'
    ]);
  });

  it('leaves a mid-month billing day unchanged', () => {
    const anchor = utc(2026, 0, 15);
    expect(chain(anchor, anchor, 'month', 3)).toEqual([
      '2026-02-15',
      '2026-03-15',
      '2026-04-15'
    ]);
  });

  it('restores a leap-day billing day on the next leap year', () => {
    const anchor = utc(2024, 1, 29);
    expect(chain(anchor, anchor, 'year', 4)).toEqual([
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29'
    ]);
  });

  it('matches deriving the n-th boundary straight from the anchor', () => {
    const anchor = utc(2026, 0, 31);
    const chained = chain(anchor, anchor, 'month', 14);
    const derived = Array.from({ length: 14 }, (_, i) => {
      let d = anchor;
      for (let n = 0; n <= i; n++) d = addInterval(d, 'month');
      return d;
    });
    // Chaining addInterval is the ratchet the anchor exists to undo, so only
    // the first boundary (before any clamp) may agree.
    expect(chained[0]).toBe(derived[0].toISOString().slice(0, 10));
    expect(chained[13]).toBe('2027-03-31');
    expect(derived[13].toISOString().slice(0, 10)).toBe('2027-03-28');
  });

  it('preserves the time-of-day component', () => {
    const anchor = utc(2026, 0, 31, 13, 45, 30);
    const result = nextPeriodEnd(anchor, anchor, 'month');
    expect(result.toISOString()).toBe('2026-02-28T13:45:30.000Z');
  });

  it('is unaffected by the process time zone', () => {
    const originalTz = process.env['TZ'];
    const anchor = utc(2025, 11, 31);
    const from = utc(2026, 1, 28);
    try {
      process.env['TZ'] = 'UTC';
      const inUtc = nextPeriodEnd(anchor, from, 'month').toISOString();
      process.env['TZ'] = 'America/New_York';
      const inNewYork = nextPeriodEnd(anchor, from, 'month').toISOString();
      expect(inUtc).toBe('2026-03-31T00:00:00.000Z');
      expect(inNewYork).toBe('2026-03-31T00:00:00.000Z');
    } finally {
      process.env['TZ'] = originalTz;
    }
  });
});
