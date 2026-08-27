/**
 * Shared by the evaluator and by the rule-payload validator. It lives apart
 * from the evaluator because the client imports the validator, and the
 * evaluator opens with `node:crypto`, which no browser bundle can resolve.
 */
export function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}
