/**
 * The feature-flag rule vocabulary, shared so the server DTO and payload
 * validator, the mock and the client rule editor agree on one list.
 *
 * The types are derived from the arrays, so a member can only be added or
 * removed in one place — a hand-written union next to a hand-written array
 * constrains the members but never the completeness of either copy.
 */
export const FEATURE_FLAG_RULE_TYPES = [
  'user',
  'role',
  'percentage',
  'attribute'
] as const;

export const FEATURE_FLAG_RULE_EFFECTS = ['include', 'exclude'] as const;

export const FEATURE_FLAG_ATTRIBUTE_FIELDS = [
  'email',
  'emailDomain',
  'createdAt',
  'custom'
] as const;

export const FEATURE_FLAG_ATTRIBUTE_OPS = [
  'eq',
  'in',
  'endsWith',
  'before',
  'after'
] as const;

export type FeatureFlagRuleType = (typeof FEATURE_FLAG_RULE_TYPES)[number];

export type FeatureFlagRuleEffect = (typeof FEATURE_FLAG_RULE_EFFECTS)[number];

export type FeatureFlagAttributeField =
  (typeof FEATURE_FLAG_ATTRIBUTE_FIELDS)[number];

export type FeatureFlagAttributeOp =
  (typeof FEATURE_FLAG_ATTRIBUTE_OPS)[number];
