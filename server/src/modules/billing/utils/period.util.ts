import type { PlanInterval } from '@app/shared/types';

/** Advances `from` by one plan interval — the local billing-period boundary. */
export function addInterval(from: Date, interval: PlanInterval): Date {
  const end = new Date(from);
  if (interval === 'year') {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}
