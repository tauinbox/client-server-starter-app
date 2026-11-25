import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, In } from 'typeorm';
import { settingsDataSourceOf } from './settings-data-source';
import { ErrorKeys, SYSTEM_ROLES } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import type { AppAbility } from '../src/modules/auth/casl/app-ability';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { User } from '../src/modules/users/entities/user.entity';

// The universal role reaches every account, so a grant that the settings
// database gives it outside the fixed self-service list must not reach the
// ability, and the role routes must refuse to write one.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('The permission ceiling of the user role (e2e)', () => {
  const tag = `user-ceiling-${Date.now()}`;
  const emails = {
    member: `${tag}-member@example.com`,
    super: `${tag}-super@example.com`
  };

  let app: INestApplication;
  let dataSource: DataSource;
  let settingsDataSource: DataSource;
  let roleService: RoleService;
  let permissionService: PermissionService;
  let abilityFactory: CaslAbilityFactory;
  const users = {} as Record<keyof typeof emails, User>;
  let userRole: Role;
  let searchUser: Permission;

  const abilityOf = async (userId: string): Promise<AppAbility> => {
    await permissionService.invalidateUserCache(userId);

    return abilityFactory.createForUser(
      userId,
      await permissionService.getRolesForUser(userId),
      await permissionService.getPermissionsForUser(userId)
    );
  };

  const outcome = async (run: Promise<unknown>): Promise<string> => {
    try {
      await run;

      return 'RESOLVED';
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse() as { errorKey?: string };

        return `${error.getStatus()} ${body.errorKey ?? ''}`.trim();
      }

      throw error;
    }
  };

  const storedGrants = (): Promise<RolePermission[]> =>
    settingsDataSource
      .getRepository(RolePermission)
      .find({ where: { roleId: userRole.id } });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    settingsDataSource = settingsDataSourceOf(app);
    roleService = app.get(RoleService);
    permissionService = app.get(PermissionService);
    abilityFactory = app.get(CaslAbilityFactory);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const roles = settingsDataSource.getRepository(Role);

    userRole = await roles.findOneByOrFail({ name: SYSTEM_ROLES.USER });
    const superRole = await roles.findOneByOrFail({ name: SYSTEM_ROLES.ADMIN });
    const permissions = await settingsDataSource
      .getRepository(Permission)
      .find();
    const found = permissions.find(
      (p) => p.action.name === 'search' && p.resource.subject === 'User'
    );

    if (!found) throw new Error('Permission search:User missing');

    searchUser = found;

    const userRepository = dataSource.getRepository(User);

    for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
      users[key] = await userRepository.save(
        userRepository.create({
          email: emails[key],
          name: `Ceiling ${key}`,
          isEmailVerified: true,
          password: null
        })
      );
    }

    await dataSource.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($3, $4)',
      [users.member.id, userRole.id, users.super.id, superRole.id]
    );
  }, 60000);

  // A refused write leaves nothing, but a regression would leave the grant on
  // the role that every account holds.
  afterEach(async () => {
    await settingsDataSource?.query(
      'DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
      [userRole.id, searchUser.id]
    );
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource
        .getRepository(User)
        .delete({ email: In(Object.values(emails)) });
    }

    await app?.close();
  });

  it('keeps a grant outside the ceiling, written straight to the database, out of the ability', async () => {
    expect((await abilityOf(users.member.id)).can('search', 'User')).toBe(
      false
    );

    // The row reaches every account for the moment it exists, so it is
    // removed in the same test whatever the assertion gives.
    await settingsDataSource.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
      [userRole.id, searchUser.id]
    );

    try {
      const ability = await abilityOf(users.member.id);

      expect(ability.can('search', 'User')).toBe(false);
      expect(ability.can('update', 'Profile')).toBe(true);
    } finally {
      await settingsDataSource.query(
        'DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
        [userRole.id, searchUser.id]
      );
    }
  });

  it('refuses a super administrator who replaces the grants with one outside the ceiling', async () => {
    const before = await storedGrants();
    const ability = await abilityOf(users.super.id);

    expect(
      await outcome(
        roleService.setPermissionsForRole(
          userRole.id,
          [
            ...before.map(({ permissionId, conditions }) => ({
              permissionId,
              conditions
            })),
            { permissionId: searchUser.id }
          ],
          { ability, actorId: users.super.id }
        )
      )
    ).toBe(`422 ${ErrorKeys.ROLES.GRANT_OUTSIDE_USER_ROLE}`);
    expect(await storedGrants()).toHaveLength(before.length);
  });

  it('refuses a super administrator who adds a grant outside the ceiling', async () => {
    const before = await storedGrants();
    const ability = await abilityOf(users.super.id);

    expect(
      await outcome(
        roleService.assignPermissionsToRole(
          userRole.id,
          { permissionIds: [searchUser.id] },
          { ability, actorId: users.super.id }
        )
      )
    ).toBe(`422 ${ErrorKeys.ROLES.GRANT_OUTSIDE_USER_ROLE}`);
    expect(await storedGrants()).toHaveLength(before.length);
  });

  it('accepts a super administrator who writes back the grants the role holds', async () => {
    const before = await storedGrants();
    const ability = await abilityOf(users.super.id);

    expect(
      await outcome(
        roleService.setPermissionsForRole(
          userRole.id,
          before.map(({ permissionId, conditions }) => ({
            permissionId,
            conditions
          })),
          { ability, actorId: users.super.id }
        )
      )
    ).toBe('RESOLVED');
  });
});
