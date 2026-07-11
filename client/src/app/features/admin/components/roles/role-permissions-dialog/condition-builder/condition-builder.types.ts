// Field operators the visual builder offers. Kept in lockstep with the
// server's ALLOWED_MONGO_OPERATORS field set: the SQL list-filter translator
// cannot honour $exists/$regex, so offering them here would build conditions
// that silently return zero rows in list/search. Logical $and/$or are the
// group-logic selector, not field operators, so they are not listed here.
export const CONDITION_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin'
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type ConditionRule = {
  id: number;
  field: string;
  operator: ConditionOperator;
  value: string;
};

export type ConditionGroup = {
  id: number;
  logic: '$and' | '$or';
  children: ConditionNode[];
};

export type ConditionNode =
  | { type: 'rule'; rule: ConditionRule }
  | { type: 'group'; group: ConditionGroup };

let nextId = 1;

export function createRule(
  field = '',
  operator: ConditionOperator = '$eq',
  value = ''
): ConditionRule {
  return { id: nextId++, field, operator, value };
}

export function createGroup(
  logic: '$and' | '$or' = '$and',
  children: ConditionNode[] = []
): ConditionGroup {
  return { id: nextId++, logic, children };
}

/** Reset ID counter (for tests). */
export function resetIdCounter(): void {
  nextId = 1;
}

/**
 * Parse a raw value string into the appropriate JS type.
 * Handles booleans, numbers, null, and falls back to string.
 */
export function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed !== '' && !isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

/**
 * Parse a comma-separated list of values (for $in / $nin operators).
 * Each item is individually type-detected.
 */
function parseArrayValue(raw: string): unknown[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(parseValue);
}

/**
 * Thrown while parsing JSON into the visual model when the input cannot be
 * represented without corruption (e.g. multi-operator objects would collapse
 * to the string "[object Object]"). Caught by jsonToModel, which returns null
 * so the dialog keeps the admin in raw-JSON mode instead of mangling the rule.
 */
class UnrepresentableConditionError extends Error {}

/** Convert a JS value back to a display string. */
function valueToString(val: unknown): string {
  if (val === null) return 'null';
  if (typeof val === 'object') {
    // Objects and arrays would stringify to "[object Object]" / "a,b" and be
    // persisted as that literal string on save
    throw new UnrepresentableConditionError(
      'Object values cannot be represented in the visual builder'
    );
  }
  return String(val);
}

// ─── JSON ↔ Model Conversion ────────────────────────────────────────────────

/**
 * Parse a MongoDB query JSON object into the visual builder model.
 * Returns null if the input cannot be meaningfully represented.
 */
export function jsonToModel(
  query: Record<string, unknown>
): ConditionGroup | null {
  try {
    return parseGroup(query);
  } catch {
    return null;
  }
}

function parseGroup(obj: Record<string, unknown>): ConditionGroup {
  const logicKey = ['$or', '$and'].find(
    (key) => key in obj && Array.isArray(obj[key])
  ) as '$or' | '$and' | undefined;
  if (logicKey) {
    if (Object.keys(obj).length > 1) {
      // A logical group with sibling keys (another logic key or field rules)
      // cannot be represented: the siblings would be silently dropped
      throw new UnrepresentableConditionError(
        `Keys next to ${logicKey} cannot be represented in the visual builder`
      );
    }
    return createGroup(
      logicKey,
      (obj[logicKey] as Record<string, unknown>[]).map(parseNode)
    );
  }
  // Treat each key as a field rule, wrapped in implicit $and
  const children = Object.entries(obj).map(([field, val]) =>
    parseFieldNode(field, val)
  );
  return createGroup('$and', children);
}

function parseNode(item: Record<string, unknown>): ConditionNode {
  // Check if this is a logical group
  if ('$or' in item || '$and' in item) {
    return { type: 'group', group: parseGroup(item) };
  }
  // Otherwise it's one or more field rules — for simplicity take the first key
  const entries = Object.entries(item);
  if (entries.length === 1) {
    return parseFieldNode(entries[0][0], entries[0][1]);
  }
  // Multiple fields in one object → wrap in $and
  const children = entries.map(([field, val]) => parseFieldNode(field, val));
  return { type: 'group', group: createGroup('$and', children) };
}

function parseFieldNode(field: string, val: unknown): ConditionNode {
  if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
    const opEntries = Object.entries(val as Record<string, unknown>);
    if (
      opEntries.length !== 1 ||
      !CONDITION_OPERATORS.includes(opEntries[0][0] as ConditionOperator)
    ) {
      // Multi-operator (e.g. { $gte: 18, $lte: 65 }), unsupported operator
      // (e.g. $exists) or empty object: forcing these through the single
      // $eq fallback would persist the literal string "[object Object]"
      throw new UnrepresentableConditionError(
        `Value of field "${field}" cannot be represented in the visual builder`
      );
    }
    const [op, opVal] = opEntries[0];
    const value = Array.isArray(opVal)
      ? opVal.map(valueToString).join(', ')
      : valueToString(opVal);
    return {
      type: 'rule',
      rule: createRule(field, op as ConditionOperator, value)
    };
  }
  // Simple equality: { field: value }
  return { type: 'rule', rule: createRule(field, '$eq', valueToString(val)) };
}

/**
 * Convert the visual model back into a MongoDB query JSON object.
 */
export function modelToJson(group: ConditionGroup): Record<string, unknown> {
  if (group.children.length === 0) return {};

  // Flatten simple $and with only top-level rules (no duplicate fields)
  if (
    group.logic === '$and' &&
    group.children.every((c) => c.type === 'rule')
  ) {
    const fields = group.children.map(
      (c) => (c as { rule: ConditionRule }).rule.field
    );
    const hasDuplicates = new Set(fields).size !== fields.length;
    if (!hasDuplicates) {
      const obj: Record<string, unknown> = {};
      for (const child of group.children) {
        const rule = (child as { rule: ConditionRule }).rule;
        obj[rule.field] = ruleToValue(rule);
      }
      return obj;
    }
  }

  return {
    [group.logic]: group.children.map((child) => nodeToJson(child))
  };
}

function nodeToJson(node: ConditionNode): Record<string, unknown> {
  if (node.type === 'group') {
    return modelToJson(node.group);
  }
  const rule = node.rule;
  return { [rule.field]: ruleToValue(rule) };
}

function ruleToValue(rule: ConditionRule): unknown {
  const { operator, value } = rule;
  if (operator === '$eq') return parseValue(value);
  if (operator === '$in' || operator === '$nin') {
    return { [operator]: parseArrayValue(value) };
  }
  return { [operator]: parseValue(value) };
}
