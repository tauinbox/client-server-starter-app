/**
 * The feature-flag vocabularies — rule shape and preview outcome — shared so
 * the server DTOs and payload validator, the mock and the client rule editor
 * agree on one list each.
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

// What a percentage rule hashes for a signed-in caller: `user` keys on the
// user id, so the bucket follows the account; `device` keys on the rollout
// cookie, so the bucket a guest had is kept across sign-in on that browser.
// An anonymous caller has only the cookie, so both read it.
export const FEATURE_FLAG_BUCKET_BY = ['user', 'device'] as const;

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

// Why a preview returned the result it did, in the order the evaluator checks
// them: the kill-switch, the environment gate, deny-overrides, the no-rules
// default, the includes, then the fall-through when no include matched.
// `excluded` means a rule denied the caller; `not-included` means no rule
// admitted it. Both give result false, and only `excluded` has a matched rule.
export const FEATURE_FLAG_PREVIEW_REASONS = [
  'disabled',
  'env-mismatch',
  'excluded',
  'included-by-rule',
  'no-rules-default-on',
  'not-included'
] as const;

export type FeatureFlagRuleType = (typeof FEATURE_FLAG_RULE_TYPES)[number];

export type FeatureFlagRuleEffect = (typeof FEATURE_FLAG_RULE_EFFECTS)[number];

export type FeatureFlagBucketBy = (typeof FEATURE_FLAG_BUCKET_BY)[number];

export type FeatureFlagAttributeField =
  (typeof FEATURE_FLAG_ATTRIBUTE_FIELDS)[number];

export type FeatureFlagAttributeOp =
  (typeof FEATURE_FLAG_ATTRIBUTE_OPS)[number];

export type FeatureFlagPreviewReason =
  (typeof FEATURE_FLAG_PREVIEW_REASONS)[number];

// The anonymous rollout id is always minted by the server as a UUID, so a
// cookie of any other shape is treated as absent rather than hashed.
export const ANON_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
