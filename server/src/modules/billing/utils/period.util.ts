import type { PlanInterval } from '@app/shared/types';

/** Last calendar day of the month that `date` falls in. */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Advances `from` by one plan interval - the local billing-period boundary.
 *
 * Clamps to the last valid day of the target month so a month-end anchor does
 * not overflow into the next month (e.g. Jan 31 + month -> Feb 28, not Mar 3).
 */
export function addInterval(from: Date, interval: PlanInterval): Date {
  const end = new Date(from);
  const anchorDay = end.getDate();

  // Pin to day 1 first so the month/year shift cannot itself overflow.
  end.setDate(1);
  if (interval === 'year') {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }

  end.setDate(
    Math.min(anchorDay, daysInMonth(end.getFullYear(), end.getMonth()))
  );
  return end;
}
