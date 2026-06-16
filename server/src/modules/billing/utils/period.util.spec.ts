import { addInterval } from './period.util';

/** Local-time [year, month-1, day] for a Date, avoiding timezone-dependent ISO assertions. */
function ymd(date: Date): [number, number, number] {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

describe('addInterval', () => {
  describe('month', () => {
    it('clamps Jan 31 to Feb 28 in a non-leap year (no overflow into March)', () => {
      expect(ymd(addInterval(new Date(2026, 0, 31), 'month'))).toEqual([
        2026, 2, 28
      ]);
    });

    it('clamps Jan 31 to Feb 29 in a leap year', () => {
      expect(ymd(addInterval(new Date(2024, 0, 31), 'month'))).toEqual([
        2024, 2, 29
      ]);
    });

    it('clamps Jan 30 to Feb 28', () => {
      expect(ymd(addInterval(new Date(2026, 0, 30), 'month'))).toEqual([
        2026, 2, 28
      ]);
    });

    it('clamps a 31st anchor to a 30-day month (Mar 31 -> Apr 30)', () => {
      expect(ymd(addInterval(new Date(2026, 2, 31), 'month'))).toEqual([
        2026, 4, 30
      ]);
    });

    it('leaves a mid-month anchor unchanged', () => {
      expect(ymd(addInterval(new Date(2026, 2, 15), 'month'))).toEqual([
        2026, 4, 15
      ]);
    });

    it('rolls the year over from December', () => {
      expect(ymd(addInterval(new Date(2026, 11, 15), 'month'))).toEqual([
        2027, 1, 15
      ]);
    });

    it('keeps a day that exists in the target month (Jan 28 -> Feb 28)', () => {
      expect(ymd(addInterval(new Date(2026, 0, 28), 'month'))).toEqual([
        2026, 2, 28
      ]);
    });

    it('preserves the time-of-day component', () => {
      const result = addInterval(new Date(2026, 0, 31, 13, 45, 30), 'month');
      expect([
        result.getHours(),
        result.getMinutes(),
        result.getSeconds()
      ]).toEqual([13, 45, 30]);
    });
  });

  describe('year', () => {
    it('advances Jan 31 to Jan 31 next year (unaffected by clamping)', () => {
      expect(ymd(addInterval(new Date(2026, 0, 31), 'year'))).toEqual([
        2027, 1, 31
      ]);
    });

    it('clamps a Feb 29 leap-day anchor to Feb 28 the next year', () => {
      expect(ymd(addInterval(new Date(2024, 1, 29), 'year'))).toEqual([
        2025, 2, 28
      ]);
    });

    it('leaves a mid-year anchor unchanged', () => {
      expect(ymd(addInterval(new Date(2026, 5, 15), 'year'))).toEqual([
        2027, 6, 15
      ]);
    });
  });
});
