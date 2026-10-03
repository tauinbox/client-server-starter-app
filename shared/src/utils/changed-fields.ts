/**
 * Returns the keys of `patch` whose value differs from the same key of
 * `before`. An edit form sends every field on each save, so the keys of the
 * request alone do not tell which fields changed. A key whose value is
 * `undefined` is not a change. Arrays compare item by item.
 */
export function changedFields(before: object, patch: object): string[] {
  const current = before as Record<string, unknown>;
  return Object.entries(patch)
    .filter(
      ([key, value]) => value !== undefined && !sameValue(value, current[key])
    )
    .map(([key]) => key);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  return a === b;
}
