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
  const end = utc(from).add(interval === 'year' ? { years: 1 } : { months: 1 });
  return new Date(end.epochMilliseconds);
}

/**
 * The boundary one interval after `from`, restored to the billing day `anchor`
 * was opened on.
 *
 * `addInterval` alone is a one-way ratchet once a boundary is chained onto its
 * own previous output: February clamps a 31st anchor to the 28th, and every
 * later boundary is then computed from the 28th, so the customer's billing day
 * never comes back. Re-applying the anchor's day-of-month after the step keeps
 * the short month clamped while restoring the original day in the next long
 * one - Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 -> May 31. The result is identical
 * to deriving the n-th boundary straight from the anchor, without having to
 * store how many periods have elapsed.
 */
export function nextPeriodEnd(
  anchor: Date,
  from: Date,
  interval: PlanInterval
): Date {
  const stepped = utc(from).add(
    interval === 'year' ? { years: 1 } : { months: 1 }
  );
  // `constrain` clamps a day the target month is too short for, exactly as the
  // step itself does, so February stays February.
  const restored = stepped.with(
    { day: utc(anchor).day },
    { overflow: 'constrain' }
  );
  return new Date(restored.epochMilliseconds);
}

/** The UTC wall-clock of `date` - the frame all boundary arithmetic runs in. */
function utc(date: Date): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(
    date.getTime()
  ).toZonedDateTimeISO('UTC');
}
