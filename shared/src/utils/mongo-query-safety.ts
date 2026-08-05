/**
 * MongoQuery operator whitelist for CASL conditions.
 *
 * Both layers apply the same allow-list, so a stored condition cannot mean one
 * thing to CASL and another to the SQL translator:
 * 1. DTO validation (input) — rejects requests with dangerous operators
 * 2. Ability factory (runtime) — defense-in-depth for pre-existing DB data
 *
 * The allowed set is exactly the operators the SQL list-filter translator
 * (`applyAbilityToUserQuery`) can honour. Accepting an operator here that the
 * translator drops makes a permission grant a single record yet return zero
 * rows in list/search — so this set is the single source of truth and the
 * translator's own operator maps are asserted to equal it (drift-guard test).
 * Operators the translator cannot faithfully reproduce in SQL ($regex/$options
 * — POSIX vs ECMAScript regex; $exists/$all/$size/$mod/$elemMatch — no
 * applicable column) are intentionally excluded, not merely unimplemented.
 *
 * $where is the critical denied one: ucast/js `where` interpreter calls
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
  '$not'
]);

export const DENIED_MONGO_OPERATORS = new Set(['$where', '$function', '$expr']);

export const PROTOTYPE_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype'
]);

/**
 * Maximum object-nesting depth accepted by the recursive safety checks.
 * No legitimate RBAC condition approaches this; without a cap a crafted
 * deeply nested body overflows the call stack (RangeError -> 500) instead
 * of being rejected as invalid input.
 */
export const MAX_MONGO_QUERY_DEPTH = 32;

export const LIST_OPERATOR_KEYS = new Set(['$in', '$nin']);

export function isJsonScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Recursively checks whether an object tree contains any unknown
 * `$`-prefixed operator (not in the allowed set), any denied key, or a list
 * operator whose array carries a non-scalar element.
 *
 * The element check keeps this layer and the SQL translator in agreement: the
 * translator can only bind scalars into `IN (:...p)` and drops the whole rule
 * otherwise, so accepting `{"$in":[{...}]}` here would store a condition that
 * silently grants nothing (or, for a deny, denies everything). `fieldMatch`,
 * the structured route to the same operator, already applies this rule.
 *
 * @returns Error message string, or `null` if safe.
 */
export function validateMongoQueryKeys(
  obj: unknown,
  path = '',
  depth = 0
): string | null {
  if (obj === null || typeof obj !== 'object') return null;

  if (depth >= MAX_MONGO_QUERY_DEPTH) {
    return `Nesting deeper than ${MAX_MONGO_QUERY_DEPTH} levels at ${path || '<root>'}`;
  }

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
      if (LIST_OPERATOR_KEYS.has(key)) {
        const opPath = path ? `${path}.${key}` : key;
        if (!Array.isArray(value)) {
          return `Operator "${key}" at ${opPath} must be an array`;
        }
        if (!value.every(isJsonScalar)) {
          return `Operator "${key}" at ${opPath} must be an array of strings, numbers, booleans or null`;
        }
      }
    }

    const childPath = path ? `${path}.${key}` : key;
    const childError = validateMongoQueryKeys(value, childPath, depth + 1);
    if (childError) return childError;
  }

  return null;
}
