import { Seeder } from '@jorgebodega/typeorm-seeding';
import { DataSource } from 'typeorm';
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
  }
}
