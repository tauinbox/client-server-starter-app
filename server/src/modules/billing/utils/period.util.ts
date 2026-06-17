import { Temporal } from '@app/shared/utils/time';
import type { PlanInterval } from '@app/shared/types';

/**
 * Advances `from` by one plan interval - the billing-period boundary.
 *
 * The arithmetic runs on the UTC wall-clock of `from`, so the result is the
 * same instant regardless of the process time zone and is unaffected by DST.
 * Temporal's default `constrain` overflow clamps a month-end anchor to the last
 * valid day of the target month (e.g. Jan 31 + month -> Feb 28, not Mar 3) and
 * preserves the time-of-day component.
 */
export function addInterval(from: Date, interval: PlanInterval): Date {
  const start = Temporal.Instant.fromEpochMilliseconds(
    from.getTime()
  ).toZonedDateTimeISO('UTC');
  const end = start.add(interval === 'year' ? { years: 1 } : { months: 1 });
  return new Date(end.epochMilliseconds);
}
