import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import type { AppAbility } from '../src/modules/auth/casl/app-ability';
import { RolesController } from '../src/modules/auth/controllers/roles.controller';
import { RoleService } from '../src/modules/auth/services/role.service';
import { Role } from '../src/modules/auth/entities/role.entity';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRule } from '../src/modules/feature-flags/entities/feature-flag-rule.entity';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';
import { FeatureFlagResolverService } from '../src/modules/feature-flags/services/feature-flag-resolver.service';
import { User } from '../src/modules/users/entities/user.entity';

// Flag role rules store role names. A rename or a delete through the roles API
// must rewrite them, or the holders lose the flag with no signal.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Role rename and delete rewrite flag role rules (e2e)', () => {
  const tag = `role-flag-rules-${Date.now()}`;
  const email = `${tag}@example.com`;
  const roleName = `${tag}-beta`;
  const renamed = `${tag}-beta-2`;
  const otherName = `${tag}-staff`;

  let app: INestApplication;
  let dataSource: DataSource;
  let controller: RolesController;
  let roleService: RoleService;
  let flagService: FeatureFlagService;
  let resolver: FeatureFlagResolverService;
  let holder: User;
  let req: JwtAuthRequest;
  const ability = (() => {
    const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
    builder.can('manage', 'all');
    return builder.build();
  })();
  const fakeReq = {} as Parameters<typeof resolver.evaluateForUser>[1];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    controller = app.get(RolesController);
    roleService = app.get(RoleService);
    flagService = app.get(FeatureFlagService);
    resolver = app.get(FeatureFlagResolverService);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const userRepository = dataSource.getRepository(User);
    holder = await userRepository.save(
      userRepository.create({
        email,
        firstName: 'Flag',
        lastName: 'Holder',
        isEmailVerified: true,
        password: null
      })
    );
    req = { user: { userId: holder.id, email } } as JwtAuthRequest;
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (dataSource) {
      await dataSource
        .getRepository(FeatureFlag)
        .createQueryBuilder()
        .delete()
        .where('key LIKE :prefix', { prefix: `${tag}%` })
        .execute();
      await dataSource
        .getRepository(Role)
        .createQueryBuilder()
        .delete()
        .where('name LIKE :prefix', { prefix: `${tag}%` })
        .execute();
      await dataSource.getRepository(User).delete({ email });
    }
    await app?.close();
  });

  async function roleNamesOf(flagId: string): Promise<string[][]> {
    const rules = await dataSource
      .getRepository(FeatureFlagRule)
      .find({ where: { flagId }, order: { createdAt: 'ASC' } });
    return rules.map((r) =>
      r.payload.type === 'role' ? r.payload.roleNames : []
    );
  }

  async function holderSees(key: string): Promise<boolean> {
    const user = await resolver.buildResolverUser(holder.id);
    return (await resolver.evaluateForUser(user, fakeReq)).flags[key] === true;
  }

  it('keeps the targeting on rename and drops the name on delete', async () => {
    const role = await roleService.create({ name: roleName });
    await roleService.assignRoleToUser(holder.id, role.id);

    const key = `${tag}-flag`;
    const flag = await flagService.create(
      {
        key,
        enabled: true,
        rules: [
          {
            type: 'role',
            effect: 'include',
            payload: { type: 'role', roleNames: [roleName, otherName] }
          },
          {
            type: 'role',
            effect: 'include',
            payload: { type: 'role', roleNames: [renamed, roleName] }
          },
          {
            type: 'user',
            effect: 'include',
            payload: { type: 'user', userIds: [] }
          }
        ]
      },
      null
    );
    const versionBefore = (await flagService.findOne(flag.id)).version;
    expect(await holderSees(key)).toBe(true);

    await controller.update(role.id, { name: renamed }, req, ability);

    expect(await roleNamesOf(flag.id)).toEqual([
      [renamed, otherName],
      [renamed],
      []
    ]);
    expect((await flagService.findOne(flag.id)).version).toBe(
      versionBefore + 1
    );
    expect(await holderSees(key)).toBe(true);

    await controller.remove(role.id, req, ability);

    expect(await roleNamesOf(flag.id)).toEqual([[otherName], [], []]);
    expect((await flagService.findOne(flag.id)).version).toBe(
      versionBefore + 2
    );
    expect(await holderSees(key)).toBe(false);
  });

  it('leaves the flags alone when no rule names the role', async () => {
    const role = await roleService.create({ name: `${tag}-unused` });
    const key = `${tag}-other`;
    const flag = await flagService.create(
      {
        key,
        enabled: true,
        rules: [
          {
            type: 'role',
            effect: 'include',
            payload: { type: 'role', roleNames: [otherName] }
          }
        ]
      },
      null
    );
    const versionBefore = (await flagService.findOne(flag.id)).version;

    await controller.update(role.id, { name: `${tag}-unused-2` }, req, ability);
    await controller.remove(role.id, req, ability);

    expect(await roleNamesOf(flag.id)).toEqual([[otherName]]);
    expect((await flagService.findOne(flag.id)).version).toBe(versionBefore);
  });

  it('rolls the rename and the delete back when the rule rewrite fails', async () => {
    const name = `${tag}-atomic`;
    const role = await roleService.create({ name });
    const flag = await flagService.create(
      {
        key: `${tag}-atomic-flag`,
        enabled: true,
        rules: [
          {
            type: 'role',
            effect: 'include',
            payload: { type: 'role', roleNames: [name] }
          }
        ]
      },
      null
    );
    const rewrite = jest
      .spyOn(flagService, 'rewriteRoleName')
      .mockRejectedValue(new Error('rewrite failed'));
    const roles = dataSource.getRepository(Role);

    await expect(
      controller.update(role.id, { name: `${name}-2` }, req, ability)
    ).rejects.toThrow('rewrite failed');
    expect((await roles.findOneByOrFail({ id: role.id })).name).toBe(name);

    await expect(controller.remove(role.id, req, ability)).rejects.toThrow(
      'rewrite failed'
    );
    expect(await roles.findOneBy({ id: role.id })).not.toBeNull();
    expect(await roleNamesOf(flag.id)).toEqual([[name]]);

    rewrite.mockRestore();
    await controller.update(role.id, { name: `${name}-2` }, req, ability);
    expect(await roleNamesOf(flag.id)).toEqual([[`${name}-2`]]);
  });
});
