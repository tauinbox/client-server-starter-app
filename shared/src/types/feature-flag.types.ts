export type FeatureFlagRuleType = 'user' | 'role' | 'percentage' | 'attribute';

export type FeatureFlagRuleEffect = 'include' | 'exclude';

export type FeatureFlagAttributeField =
  | 'email'
  | 'emailDomain'
  | 'createdAt'
  | 'custom';

export type FeatureFlagAttributeOp =
  | 'eq'
  | 'in'
  | 'endsWith'
  | 'before'
  | 'after';

export type FeatureFlagRulePayload =
  | { type: 'user'; userIds: string[] }
  | { type: 'role'; roleNames: string[] }
  | { type: 'percentage'; percent: number }
  | {
      type: 'attribute';
      field: FeatureFlagAttributeField;
      op: FeatureFlagAttributeOp;
      value: unknown;
      customKey?: string;
    };

export type FeatureFlagRuleResponse = {
  id: string;
  flagId: string;
  effect: FeatureFlagRuleEffect;
  payload: FeatureFlagRulePayload;
  createdAt: string;
  updatedAt: string;
};

export type FeatureFlagResponse = {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  environments: string[];
  public: boolean;
  version: number;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  rules: FeatureFlagRuleResponse[];
};

export type EvaluatedFeatureFlagsResponse = {
  flags: Record<string, boolean>;
  evaluatedAt: string;
};

export type FeatureFlagPreviewReason =
  | 'disabled'
  | 'env-mismatch'
  | 'excluded'
  | 'included-by-rule'
  | 'no-rules-default-on';

export type FeatureFlagPreviewMatchedRule = {
  index: number;
  type: FeatureFlagRuleType;
  effect: FeatureFlagRuleEffect;
};

export type FeatureFlagPreviewResult = {
  result: boolean;
  reason: FeatureFlagPreviewReason;
  matchedRule: FeatureFlagPreviewMatchedRule | null;
};
