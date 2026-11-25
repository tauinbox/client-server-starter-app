import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { settingsDataSourceOf } from './settings-data-source';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { User } from '../src/modules/users/entities/user.entity';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRuleUser } from '../src/modules/feature-flags/entities/feature-flag-rule-user.entity';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';
import { FeatureFlagResolverService } from '../src/modules/feature-flags/services/feature-flag-resolver.service';
import { SettingsChangeLogService } from '../src/modules/core/settings-change-log/settings-change-log.service';
import type { FeatureFlagRuleDto } from '../src/modules/feature-flags/dtos/feature-flag-rule.dto';
import { flagAuditActor } from './flag-audit-actor';

// The members of a `user` rule are rows of the user, not ids in the settings
// row of the rule. These cases run on the real schema: the foreign key to the
// user, the delete of the members of a removed rule and the read of both forms.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const userRule = (userIds: string[]): FeatureFlagRuleDto => ({
  effect: 'include',
  payload: { type: 'user', userIds }
});

runWithInfra('Feature flag user rule members (e2e)', () => {
  const tag = `ff-members-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];

  let app: INestApplication;
  let dataSource: DataSource;
  let settingsDataSource: DataSource;
  let flags: FeatureFlagService;
  let resolver: FeatureFlagResolverService;
  let settingsLog: SettingsChangeLogService;

  const saveUser = async (name: string): Promise<User> => {
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({
        email: `${tag}-${name}@example.com`,
        name: 'Members Probe',
        isEmailVerified: true,
        password: null
      })
    );

    userIds.push(user.id);

    return user;
  };
  const createFlag = (name: string, rules: FeatureFlagRuleDto[]) =>
    flags.create(
      { key: `${tag}-${name}`, enabled: true, rules },
      SYSTEM_ABILITY,
      flagAuditActor()
    );
  const membersOf = async (ruleIds: string[]): Promise<string[]> => {
    const rows = await dataSource
      .getRepository(FeatureFlagRuleUser)
      .createQueryBuilder('m')
      .where('m.ruleId IN (:...ruleIds)', { ruleIds })
      .getMany();

    return rows.map((r) => r.userId).toSorted();
  };
  const enabledFor = (userId: string, key: string) =>
    resolver.isEnabledForUserId(userId, key);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    settingsDataSource = settingsDataSourceOf(app);
    flags = app.get(FeatureFlagService);
    resolver = app.get(FeatureFlagResolverService);
    settingsLog = app.get(SettingsChangeLogService);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await settingsDataSource
        .getRepository(FeatureFlag)
        .createQueryBuilder()
        .delete()
        .where('key LIKE :prefix', { prefix: `${tag}%` })
        .execute();
      await settingsLog.applyPending();

      if (userIds.length > 0) {
        await dataSource.getRepository(User).delete(userIds);
      }
    }

    await app?.close();
  });

  it('writes a member row for each user and evaluates from them', async () => {
    const [a, b, outsider] = await Promise.all([
      saveUser('a'),
      saveUser('b'),
      saveUser('outsider')
    ]);
    const flag = await createFlag('write', [userRule([a.id, b.id])]);

    expect(await membersOf([flag.rules[0].id])).toEqual(
      [a.id, b.id].toSorted()
    );
    expect(await enabledFor(a.id, flag.key)).toBe(true);
    expect(await enabledFor(outsider.id, flag.key)).toBe(false);
  });

  it('reads the members from their rows when the payload has none', async () => {
    const member = await saveUser('rows-only');
    const flag = await createFlag('rows-only', [userRule([member.id])]);

    await settingsDataSource.query(
      `UPDATE "feature_flag_rules" SET "payload" = '{"type":"user","userIds":[]}' WHERE "flag_id" = $1`,
      [flag.id]
    );
    await settingsLog.applyPending();

    const read = await flags.findOne(flag.id, SYSTEM_ABILITY);

    expect(read.rules[0].payload).toEqual({
      type: 'user',
      userIds: [member.id]
    });
    expect(await enabledFor(member.id, flag.key)).toBe(true);
  });

  it('still reads the payload ids that a node of the previous build wrote', async () => {
    const member = await saveUser('payload-only');
    const flag = await createFlag('payload-only', [userRule([member.id])]);

    await dataSource.query(
      `DELETE FROM "feature_flag_rule_users" WHERE "rule_id" = $1`,
      [flag.rules[0].id]
    );
    await resolver.invalidateAll();

    expect(await enabledFor(member.id, flag.key)).toBe(true);
  });

  it('refuses a user id with no user row and writes nothing', async () => {
    const member = await saveUser('known');
    const missing = randomUUID();

    await expect(
      createFlag('unknown-create', [userRule([member.id, missing])])
    ).rejects.toMatchObject({
      status: 422,
      errorKey: ErrorKeys.FEATURE_FLAGS.UNKNOWN_RULE_USER
    });
    expect(
      await settingsDataSource
        .getRepository(FeatureFlag)
        .countBy({ key: `${tag}-unknown-create` })
    ).toBe(0);

    const flag = await createFlag('unknown-update', [userRule([member.id])]);

    await expect(
      flags.update(
        flag.id,
        { rules: [userRule([missing])] },
        {
          ifMatch: { any: true },
          ability: SYSTEM_ABILITY,
          actor: flagAuditActor()
        }
      )
    ).rejects.toMatchObject({
      status: 422,
      errorKey: ErrorKeys.FEATURE_FLAGS.UNKNOWN_RULE_USER
    });

    const after = await flags.findOne(flag.id, SYSTEM_ABILITY);

    expect(after.version).toBe(flag.version);
    expect(after.rules.map((r) => r.id)).toEqual([flag.rules[0].id]);
    expect(await membersOf([flag.rules[0].id])).toEqual([member.id]);
  });

  it('accepts a soft deleted user, as the payload did', async () => {
    const member = await saveUser('soft-deleted');

    await dataSource.getRepository(User).softDelete(member.id);
    const flag = await createFlag('soft-deleted', [userRule([member.id])]);

    expect(await membersOf([flag.rules[0].id])).toEqual([member.id]);
  });

  it('deletes the members of replaced and deleted rules in the apply', async () => {
    const [a, b] = await Promise.all([
      saveUser('replace-a'),
      saveUser('replace-b')
    ]);
    const flag = await createFlag('replace', [userRule([a.id])]);
    const oldRuleId = flag.rules[0].id;
    const updated = await flags.update(
      flag.id,
      { rules: [userRule([b.id])] },
      {
        ifMatch: { any: false, versions: [flag.version] },
        ability: SYSTEM_ABILITY,
        actor: flagAuditActor()
      }
    );
    const newRuleId = updated.rules[0].id;

    expect(await membersOf([oldRuleId])).toEqual([]);
    expect(await membersOf([newRuleId])).toEqual([b.id]);
    expect(await enabledFor(a.id, flag.key)).toBe(false);
    expect(await enabledFor(b.id, flag.key)).toBe(true);

    await flags.delete(flag.id, SYSTEM_ABILITY, flagAuditActor());

    expect(await membersOf([newRuleId])).toEqual([]);
  });

  it('removes the member rows of a user whose row is deleted', async () => {
    const member = await saveUser('purged');
    const flag = await createFlag('purged', [userRule([member.id])]);

    await dataSource.getRepository(User).delete(member.id);

    expect(await membersOf([flag.rules[0].id])).toEqual([]);
  });
});
