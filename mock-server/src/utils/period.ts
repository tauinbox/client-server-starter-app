// Direct polyfill import, not the @app/shared barrel: the barrel resolves from
// shared/src, which cannot reach a node_modules holding the polyfill when this
// file is loaded in-process by the client Playwright e2e suite.
import { Temporal } from 'temporal-polyfill';

/**
 * Advances `from` by one plan interval on the UTC wall-clock, so the boundary is
 * the same instant in any process time zone and DST-safe. Temporal's default
 * `constrain` overflow clamps a month-end anchor to the last valid day of the
 * target month (Jan 31 + month -> Feb 28).
 * Mirrors the server's `addInterval` (server/src/modules/billing/utils/period.util.ts).
 */
export function addInterval(from: Date, interval: 'month' | 'year'): Date {
  const end = utc(from).add(interval === 'year' ? { years: 1 } : { months: 1 });
  return new Date(end.epochMilliseconds);
}

/**
 * The boundary one interval after `from`, restored to the billing day `anchor`
 * was opened on, so a February clamp cannot walk a month-end customer
 * permanently backwards.
 * Mirrors the server's `nextPeriodEnd` (server/src/modules/billing/utils/period.util.ts).
 */
export function nextPeriodEnd(
  anchor: Date,
  from: Date,
  interval: 'month' | 'year'
): Date {
  const stepped = utc(from).add(
    interval === 'year' ? { years: 1 } : { months: 1 }
  );
  const restored = stepped.with(
    { day: utc(anchor).day },
    { overflow: 'constrain' }
  );
  return new Date(restored.epochMilliseconds);
}

function utc(date: Date): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(
    date.getTime()
  ).toZonedDateTimeISO('UTC');
}
