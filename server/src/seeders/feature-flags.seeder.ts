import { Seeder } from '@jorgebodega/typeorm-seeding';
import { DataSource } from 'typeorm';
import { OAUTH_PROVIDER_FLAGS } from '@app/shared/constants';
import { FeatureFlag } from '../modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRule } from '../modules/feature-flags/entities/feature-flag-rule.entity';

export default class FeatureFlagsSeeder extends Seeder {
  async run(dataSource: DataSource): Promise<void> {
    const flagRepo = dataSource.getRepository(FeatureFlag);
    const ruleRepo = dataSource.getRepository(FeatureFlagRule);

    const newDashboard = flagRepo.create({
      key: 'new-dashboard',
      description: 'Hidden behind a flag while in development',
      enabled: false,
      environments: [],
      public: false,
      version: 1
    });
    const betaExport = flagRepo.create({
      key: 'beta-export',
      description: 'Beta export rolled out to a 10% sample of users',
      enabled: true,
      environments: [],
      public: false,
      version: 1
    });
    const [, savedBeta] = await flagRepo.save([newDashboard, betaExport]);

    await ruleRepo.save(
      ruleRepo.create({
        flagId: savedBeta.id,
        type: 'percentage',
        effect: 'include',
        payload: { type: 'percentage', percent: 10 }
      })
    );

    // One public flag per OAuth provider. Each is enabled by default (the manual
    // override) and carries an attribute rule that only includes it when the
    // provider's env-derived `*Configured` attribute is true — so an unconfigured
    // provider stays hidden even with the flag on. The login UI hides the whole
    // OAuth block when none resolve true.
    const oauthFlags = OAUTH_PROVIDER_FLAGS.map(({ provider, flagKey }) =>
      flagRepo.create({
        key: flagKey,
        description: `Show the ${provider} OAuth login button (gated by provider configuration)`,
        enabled: true,
        environments: [],
        public: true,
        version: 1
      })
    );
    const savedOAuthFlags = await flagRepo.save(oauthFlags);

    const attributeKeyByFlagKey = new Map<string, string>(
      OAUTH_PROVIDER_FLAGS.map((p) => [p.flagKey, p.attributeKey])
    );
    await ruleRepo.save(
      savedOAuthFlags.map((flag) =>
        ruleRepo.create({
          flagId: flag.id,
          type: 'attribute',
          effect: 'include',
          payload: {
            type: 'attribute',
            field: 'custom',
            op: 'eq',
            value: true,
            customKey: attributeKeyByFlagKey.get(flag.key)
          }
        })
      )
    );
  }
}
