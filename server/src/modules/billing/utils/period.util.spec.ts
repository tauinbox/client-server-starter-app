import { addInterval } from './period.util';

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
