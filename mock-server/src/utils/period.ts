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
  const start = Temporal.Instant.fromEpochMilliseconds(
    from.getTime()
  ).toZonedDateTimeISO('UTC');
  const end = start.add(interval === 'year' ? { years: 1 } : { months: 1 });
  return new Date(end.epochMilliseconds);
}
