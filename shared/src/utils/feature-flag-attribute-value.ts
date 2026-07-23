import type { FeatureFlagAttributeOp } from '../types/feature-flag.types';
import { toTimestamp } from './feature-flag-evaluator';

export const ATTRIBUTE_VALUE_MAX_LENGTH = 200;
export const ATTRIBUTE_VALUE_MAX_ITEMS = 100;

type AttributeScalar = string | number | boolean | null;

function isScalar(value: unknown): value is AttributeScalar {
  if (value === null) return true;
  if (typeof value === 'string') {
    return value.length <= ATTRIBUTE_VALUE_MAX_LENGTH;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'boolean';
}

/**
 * Returns an error message when `value` cannot be compared by `op`, or null
 * when it can. The evaluator yields false on a shape it cannot compare, so
 * without this an unusable rule is stored and reads as active in the admin UI.
 * The caps bound the payload, which is persisted as unconstrained jsonb.
 */
export function attributeValueError(
  op: FeatureFlagAttributeOp,
  value: unknown
): string | null {
  switch (op) {
    case 'eq':
      return isScalar(value)
        ? null
        : `attribute rule with op=eq requires value: string, number, boolean or null (strings up to ${ATTRIBUTE_VALUE_MAX_LENGTH} chars)`;
    case 'in':
      return Array.isArray(value) &&
        value.length > 0 &&
        value.length <= ATTRIBUTE_VALUE_MAX_ITEMS &&
        value.every(isScalar)
        ? null
        : `attribute rule with op=in requires value: a non-empty array of up to ${ATTRIBUTE_VALUE_MAX_ITEMS} scalars`;
    case 'endsWith':
      return typeof value === 'string' &&
        value.length > 0 &&
        value.length <= ATTRIBUTE_VALUE_MAX_LENGTH
        ? null
        : `attribute rule with op=endsWith requires value: a non-empty string of up to ${ATTRIBUTE_VALUE_MAX_LENGTH} chars`;
    case 'before':
    case 'after':
      return (typeof value === 'string' || typeof value === 'number') &&
        !(
          typeof value === 'string' && value.length > ATTRIBUTE_VALUE_MAX_LENGTH
        ) &&
        toTimestamp(value) !== null
        ? null
        : `attribute rule with op=${op} requires value: an ISO date string or an epoch-millisecond number`;
  }
}
