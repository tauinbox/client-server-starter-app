import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { AuditService } from '../src/modules/audit/audit.service';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRule } from '../src/modules/feature-flags/entities/feature-flag-rule.entity';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';
import { flagAuditActor } from './flag-audit-actor';
import type { FeatureFlagRuleDto } from '../src/modules/feature-flags/dtos/feature-flag-rule.dto';
import type { IfMatchCondition } from '@app/shared/utils/if-match';

// A flag and its rules save in one transaction: a rejected or failed rule
// write leaves the flag row, its version and its old rules unchanged.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

// The trigger rejects this percent only on the flags of this suite, so it
// cannot touch a parallel suite.
const FAILING_PERCENT = 37;

const percentRule = (percent: number): FeatureFlagRuleDto => ({
  effect: 'include',
  payload: { type: 'percentage', percent }
});

/** The If-Match condition of one strong version tag. */
const version = (v: number): IfMatchCondition => ({
  any: false,
  versions: [v]
});

runWithInfra('Feature flag and rules save atomically (e2e)', () => {
  const tag = `ff-atomic-${Date.now()}`;
  const trigger = tag.replace(/-/g, '_');

  let app: INestApplication;
  let dataSource: DataSource;
  let flagService: FeatureFlagService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    flagService = app.get(FeatureFlagService);
    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
  }, 60000);

  afterEach(async () => {
    await dataSource.query(
      `DROP TRIGGER IF EXISTS ${trigger} ON feature_flag_rules`
    );
    await dataSource.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (dataSource) {
      await dataSource
        .getRepository(FeatureFlag)
        .createQueryBuilder()
        .delete()
        .where('key LIKE :prefix', { prefix: `${tag}%` })
        .execute();
    }
    await app?.close();
  });

  // The flag row written earlier in the same transaction is visible to the
  // trigger, so a create fails here as well as an update.
  async function failRuleInserts(): Promise<void> {
    await dataSource.query(`
      CREATE FUNCTION ${trigger}() RETURNS trigger AS $$
      BEGIN
        IF NEW.payload->>'percent' = '${FAILING_PERCENT}' AND EXISTS (
          SELECT 1 FROM feature_flags
          WHERE id = NEW.flag_id AND "key" LIKE '${tag}%'
        ) THEN
          RAISE EXCEPTION 'rule insert failed';
        END IF;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql`);
    await dataSource.query(`
      CREATE TRIGGER ${trigger} BEFORE INSERT ON feature_flag_rules
      FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
  }

  async function percentsOf(flagId: string): Promise<number[]> {
    const rules = await dataSource
      .getRepository(FeatureFlagRule)
      .find({ where: { flagId }, order: { createdAt: 'ASC' } });
    return rules.map((r) =>
      r.payload.type === 'percentage' ? r.payload.percent : -1
    );
  }

  async function seed(name: string): Promise<FeatureFlag> {
    return flagService.create(
      { key: `${tag}-${name}`, enabled: false, rules: [percentRule(10)] },
      SYSTEM_ABILITY,
      flagAuditActor()
    );
  }

  it('replaces the rules and bumps the version once', async () => {
    const flag = await seed('replace');

    const updated = await flagService.update(
      flag.id,
      { enabled: true, rules: [percentRule(20), percentRule(30)] },
      version(flag.version),
      SYSTEM_ABILITY,
      flagAuditActor()
    );

    expect(updated).toMatchObject({ enabled: true, version: flag.version + 1 });
    expect(await percentsOf(flag.id)).toEqual([20, 30]);
  });

  it('keeps the rules when the update carries none', async () => {
    const flag = await seed('keep');

    await flagService.update(
      flag.id,
      { enabled: true },
      version(flag.version),
      SYSTEM_ABILITY,
      flagAuditActor()
    );

    expect(await percentsOf(flag.id)).toEqual([10]);
  });

  it('changes nothing when a rule payload is rejected', async () => {
    const flag = await seed('invalid');

    await expect(
      flagService.update(
        flag.id,
        { enabled: true, rules: [percentRule(20), percentRule(150)] },
        version(flag.version),
        SYSTEM_ABILITY,
        flagAuditActor()
      )
    ).rejects.toMatchObject({ status: 422 });

    expect(await flagService.findOne(flag.id, SYSTEM_ABILITY)).toMatchObject({
      enabled: false,
      version: flag.version
    });
    expect(await percentsOf(flag.id)).toEqual([10]);
  });

  it('writes no rule on a stale version', async () => {
    const flag = await seed('stale');
    await flagService.update(
      flag.id,
      { enabled: true },
      version(flag.version),
      SYSTEM_ABILITY,
      flagAuditActor()
    );

    await expect(
      flagService.update(
        flag.id,
        { rules: [percentRule(20)] },
        version(flag.version),
        SYSTEM_ABILITY,
        flagAuditActor()
      )
    ).rejects.toMatchObject({ status: 412 });

    expect(await percentsOf(flag.id)).toEqual([10]);
  });

  it('refuses an If-Match version that a concurrent write reached after the read', async () => {
    const flag = await seed('raced');
    await flagService.update(
      flag.id,
      { enabled: true },
      version(flag.version),
      SYSTEM_ABILITY,
      flagAuditActor()
    );
    // The read of the next update returns the row as it was before that write.
    jest
      .spyOn(app.get(getRepositoryToken(FeatureFlag)), 'findOne')
      .mockResolvedValueOnce(flag);

    await expect(
      flagService.update(
        flag.id,
        { rules: [percentRule(20)] },
        version(flag.version + 1),
        SYSTEM_ABILITY,
        flagAuditActor()
      )
    ).rejects.toMatchObject({ status: 412 });

    expect(await flagService.findOne(flag.id, SYSTEM_ABILITY)).toMatchObject({
      enabled: true,
      version: flag.version + 1
    });
    expect(await percentsOf(flag.id)).toEqual([10]);
  });

  it('rolls the flag write back when a rule insert fails', async () => {
    const flag = await seed('rollback');
    await failRuleInserts();

    await expect(
      flagService.update(
        flag.id,
        {
          enabled: true,
          rules: [percentRule(20), percentRule(FAILING_PERCENT)]
        },
        version(flag.version),
        SYSTEM_ABILITY,
        flagAuditActor()
      )
    ).rejects.toThrow('rule insert failed');

    expect(await flagService.findOne(flag.id, SYSTEM_ABILITY)).toMatchObject({
      enabled: false,
      version: flag.version
    });
    expect(await percentsOf(flag.id)).toEqual([10]);
  });

  it('creates no flag when a rule insert fails', async () => {
    const key = `${tag}-create-rollback`;
    await failRuleInserts();

    await expect(
      flagService.create(
        { key, rules: [percentRule(20), percentRule(FAILING_PERCENT)] },
        SYSTEM_ABILITY,
        flagAuditActor()
      )
    ).rejects.toThrow('rule insert failed');

    expect(
      await dataSource.getRepository(FeatureFlag).findOneBy({ key })
    ).toBeNull();
  });
});
