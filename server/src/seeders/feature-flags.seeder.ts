import { Seeder } from '@jorgebodega/typeorm-seeding';
import { DataSource } from 'typeorm';
import {
  BILLING_CONFIGURED_ATTRIBUTE,
  BILLING_FLAG_KEY,
  BILLING_PROVIDER_FLAGS,
  OAUTH_PROVIDER_FLAGS
} from '@app/shared/constants';
import type {
  FeatureFlagRuleEffect,
  FeatureFlagRulePayload,
  FeatureFlagRuleType
} from '@app/shared/types';
import { FeatureFlag } from '../modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRule } from '../modules/feature-flags/entities/feature-flag-rule.entity';

type FlagSeed = {
  key: string;
  description: string;
  enabled: boolean;
  public: boolean;
  rule?: {
    type: FeatureFlagRuleType;
    effect: FeatureFlagRuleEffect;
    payload: FeatureFlagRulePayload;
  };
};

const FLAGS: FlagSeed[] = [
  {
    key: 'new-dashboard',
    description: 'Hidden behind a flag while in development',
    enabled: false,
    public: false
  },
  {
    key: 'beta-export',
    description: 'Beta export rolled out to a 10% sample of users',
    enabled: true,
    public: false,
    rule: {
      type: 'percentage',
      effect: 'include',
      payload: { type: 'percentage', percent: 10 }
    }
  },
  // Enabled by default, but the attribute rule keeps an unconfigured provider
  // hidden; the login UI drops the OAuth block when none resolve true.
  ...OAUTH_PROVIDER_FLAGS.map(({ provider, flagKey, attributeKey }) => ({
    key: flagKey,
    description: `Show the ${provider} OAuth login button (gated by provider configuration)`,
    enabled: true,
    public: true,
    rule: {
      type: 'attribute' as const,
      effect: 'include' as const,
      payload: {
        type: 'attribute' as const,
        field: 'custom' as const,
        op: 'eq' as const,
        value: true,
        customKey: attributeKey
      }
    }
  })),
  // Gated on `billingConfigured` so billing stays hidden until at least one
  // provider is env-configured.
  {
    key: BILLING_FLAG_KEY,
    description:
      'Show billing (gated by at least one provider being configured)',
    enabled: true,
    public: true,
    rule: {
      type: 'attribute',
      effect: 'include',
      payload: {
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: true,
        customKey: BILLING_CONFIGURED_ATTRIBUTE
      }
    }
  },
  // Seeded off: an admin enables each provider explicitly.
  ...BILLING_PROVIDER_FLAGS.map(({ provider, enabledFlagKey }) => ({
    key: enabledFlagKey,
    description: `Admin kill-switch enabling the ${provider} billing provider`,
    enabled: false,
    public: false
  }))
];

export default class FeatureFlagsSeeder extends Seeder {
  // Additive and idempotent: flags already present are left untouched, so a
  // re-run inserts nothing rather than hitting UQ_feature_flags_key. Rules are
  // seeded only for flags created by this run — an existing flag whose rule an
  // admin deleted must not have it resurrected.
  async run(dataSource: DataSource): Promise<void> {
    const flagRepo = dataSource.getRepository(FeatureFlag);
    const ruleRepo = dataSource.getRepository(FeatureFlagRule);

    const existingKeys = new Set((await flagRepo.find()).map((f) => f.key));
    const missing = FLAGS.filter((seed) => !existingKeys.has(seed.key));
    if (missing.length === 0) return;

    const created = await flagRepo.save(
      missing.map((seed) =>
        flagRepo.create({
          key: seed.key,
          description: seed.description,
          enabled: seed.enabled,
          environments: [],
          public: seed.public,
          version: 1
        })
      )
    );

    const idByKey = new Map(created.map((flag) => [flag.key, flag.id]));
    const rules = missing.flatMap((seed) => {
      const flagId = idByKey.get(seed.key);
      if (!seed.rule || !flagId) return [];
      return [ruleRepo.create({ ...seed.rule, flagId })];
    });
    if (rules.length === 0) return;

    await ruleRepo.save(rules);
  }
}
