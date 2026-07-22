function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function definedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => record[key] !== undefined);
}

/**
 * Structural equality for JSON-shaped values.
 *
 * Object keys are compared as a set, so a payload that comes back from the API
 * with a different key order does not read as an edit - unlike a
 * `JSON.stringify` comparison, which is key-order sensitive. Array order is
 * still significant, and keys holding `undefined` count as absent, matching how
 * the value would have been serialized.
 *
 * Only plain objects, arrays and primitives are inspected; any other object
 * (Date, Map, class instance) compares equal only by reference.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (!isPlainRecord(a) || !isPlainRecord(b)) return false;

  const aKeys = definedKeys(a);
  if (aKeys.length !== definedKeys(b).length) return false;
  return aKeys.every((key) => deepEqual(a[key], b[key]));
}
