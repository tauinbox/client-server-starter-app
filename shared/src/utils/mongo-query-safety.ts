/**
 * MongoQuery operator whitelist/denylist for CASL conditions.
 *
 * Used at two layers:
 * 1. DTO validation (input) — rejects requests with dangerous operators
 * 2. Ability factory (runtime) — defense-in-depth for pre-existing DB data
 *
 * Operator list derived from @ucast/mongo v2 allParsingInstructions.
 * $where is the critical one: ucast/js `where` interpreter calls
 * `condition.value.call(object)` — arbitrary code execution.
 */

export const ALLOWED_MONGO_OPERATORS = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$and',
  '$or',
  '$nor',
  '$not',
  '$exists',
  '$regex',
  '$options',
  '$all',
  '$size',
  '$mod',
  '$elemMatch'
]);

export const DENIED_MONGO_OPERATORS = new Set([
  '$where',
  '$function',
  '$expr'
]);

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively checks whether an object tree contains any denied
 * MongoQuery operator or prototype-pollution key.
 *
 * @returns The offending key name, or `null` if the tree is safe.
 */
export function findDeniedMongoKey(obj: unknown): string | null {
  if (obj === null || typeof obj !== 'object') return null;

  const entries = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as const)
    : Object.entries(obj as Record<string, unknown>);

  for (const [key, value] of entries) {
    if (PROTOTYPE_KEYS.has(key)) return key;
    if (DENIED_MONGO_OPERATORS.has(key)) return key;

    const nested = findDeniedMongoKey(value);
    if (nested) return nested;
  }

  return null;
}

/**
 * Recursively checks whether an object tree contains any unknown
 * `$`-prefixed operator (not in the allowed set) or any denied key.
 *
 * @returns Error message string, or `null` if safe.
 */
export function validateMongoQueryKeys(
  obj: unknown,
  path = ''
): string | null {
  if (obj === null || typeof obj !== 'object') return null;

  const entries = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as const)
    : Object.entries(obj as Record<string, unknown>);

  for (const [key, value] of entries) {
    if (PROTOTYPE_KEYS.has(key)) {
      return `Prototype pollution key "${key}" at ${path}`;
    }

    if (key.startsWith('$')) {
      if (DENIED_MONGO_OPERATORS.has(key)) {
        return `Operator "${key}" is not allowed at ${path}`;
      }
      if (!ALLOWED_MONGO_OPERATORS.has(key)) {
        return `Unknown operator "${key}" at ${path}`;
      }
    }

    const childPath = path ? `${path}.${key}` : key;
    const childError = validateMongoQueryKeys(value, childPath);
    if (childError) return childError;
  }

  return null;
}
