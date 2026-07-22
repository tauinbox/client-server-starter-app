/**
 * Deployment environments the server can run as (the ENVIRONMENT variable).
 * Feature-flag targeting compares a flag's `environments` against that value,
 * so a name outside this list can never match: accepting one would silently
 * disable the flag everywhere instead of reporting the typo.
 */
export const APP_ENVIRONMENTS = [
  'local',
  'development',
  'staging',
  'production'
] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/**
 * Trims, lowercases and de-duplicates an environments list, preserving order.
 * Non-string entries pass through untouched so the caller's own type check
 * reports them rather than this helper swallowing them.
 */
export function normalizeEnvironmentList(
  values: readonly unknown[]
): unknown[] {
  const seen = new Set<unknown>();
  const normalized: unknown[] = [];
  for (const entry of values) {
    const value = typeof entry === 'string' ? entry.trim().toLowerCase() : entry;
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}
