/**
 * Advances `from` by one plan interval, clamping to the last valid day of the
 * target month so a month-end anchor does not overflow (Jan 31 + month -> Feb 28).
 * Mirrors the server's `addInterval` (server/src/modules/billing/utils/period.util.ts).
 */
export function addInterval(from: Date, interval: 'month' | 'year'): Date {
  const end = new Date(from);
  const anchorDay = end.getDate();
  end.setDate(1);
  if (interval === 'year') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  const daysInTarget = new Date(
    end.getFullYear(),
    end.getMonth() + 1,
    0
  ).getDate();
  end.setDate(Math.min(anchorDay, daysInTarget));
  return end;
}
