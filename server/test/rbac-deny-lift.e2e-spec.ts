import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { subject } from '@casl/ability';
import { DataSource, In } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import type { PermissionCondition } from '@app/shared/types';
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

// A deny row always lives in a role of its own, so a delegated admin could
// lift it by removing the row or the role. The real RoleService, the real
// ability factory and Postgres are all links of that chain.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Lifting a deny restriction (e2e)', () => {
  const tag = `deny-lift-${Date.now()}`;
  const emails = {
    ceo: `${tag}-ceo@example.com`,
    actor: `${tag}-actor@example.com`,
    accomplice: `${tag}-accomplice@example.com`,
    unrestricted: `${tag}-unrestricted@example.com`
  };

  let app: INestApplication;
  let dataSource: DataSource;
  let roleService: RoleService;
  let permissionService: PermissionService;
  let abilityFactory: CaslAbilityFactory;

  const users: Record<keyof typeof emails, User> = {} as Record<
    keyof typeof emails,
    User
  >;
  let updateUser: Permission;
  let adminRole: Role;
  let restrictRole: Role;
  let accompliceRole: Role;
  const denyCeo = (): PermissionCondition => ({
    effect: 'deny',
    fieldMatch: { email: [emails.ceo] }
  });

  const abilityOf = async (userId: string): Promise<AppAbility> => {
    await permissionService.invalidateUserCache(userId);
    return abilityFactory.createForUser(
      userId,
      await permissionService.getRolesForUser(userId),
      await permissionService.getPermissionsForUser(userId)
    );
  };

  const canUpdateCeo = async (userId: string): Promise<boolean> =>
    (await abilityOf(userId)).can('update', subject('User', users.ceo));

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

  const liftRefused = `403 ${ErrorKeys.ROLES.CANNOT_LIFT_DENY}`;
  const grantRefused = `403 ${ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION}`;

  const createRole = (name: string): Promise<Role> =>
    roleService.create({ name: `${tag}-${name}` });

  const giveRoles = async (user: User, roles: Role[]): Promise<void> => {
    for (const role of roles) {
      await roleService.assignRoleToUser(user.id, role.id);
    }
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    roleService = app.get(RoleService);
    permissionService = app.get(PermissionService);
    abilityFactory = app.get(CaslAbilityFactory);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const permissions = await dataSource.getRepository(Permission).find();
    const find = (action: string, resource: string): Permission => {
      const found = permissions.find(
        (p) => p.action.name === action && p.resource.subject === resource
      );
      if (!found) throw new Error(`Permission ${action}:${resource} missing`);
      return found;
    };
    updateUser = find('update', 'User');
    const updateRole = find('update', 'Role');

    const userRepository = dataSource.getRepository(User);
    for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
      users[key] = await userRepository.save(
        userRepository.create({
          email: emails[key],
          firstName: 'Deny',
          lastName: key,
          isEmailVerified: true,
          password: null
        })
      );
    }

    adminRole = await createRole('admin');
    await roleService.setPermissionsForRole(adminRole.id, [
      { permissionId: updateUser.id },
      { permissionId: updateRole.id }
    ]);
    restrictRole = await createRole('restrict');
    await roleService.setPermissionsForRole(restrictRole.id, [
      { permissionId: updateUser.id, conditions: denyCeo() }
    ]);
    accompliceRole = await createRole('accomplice');

    await giveRoles(users.actor, [adminRole, restrictRole]);
    await giveRoles(users.accomplice, [accompliceRole]);
    await giveRoles(users.unrestricted, [adminRole]);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.getRepository(Role).delete({
        name: In(['admin', 'restrict', 'accomplice'].map((n) => `${tag}-${n}`))
      });
      await dataSource
        .getRepository(User)
        .delete({ email: In(Object.values(emails)) });
    }
    await app?.close();
  });

  it('starts with the actor barred from the CEO', async () => {
    expect(await canUpdateCeo(users.actor.id)).toBe(false);
    expect(await canUpdateCeo(users.unrestricted.id)).toBe(true);
  });

  it('refuses the actor removing their own restriction role', async () => {
    const actorAbility = await abilityOf(users.actor.id);

    expect(
      await outcome(
        roleService.removeRoleFromUser(
          users.actor.id,
          restrictRole.id,
          actorAbility,
          users.actor.id
        )
      )
    ).toBe(liftRefused);
    expect(await canUpdateCeo(users.actor.id)).toBe(false);
  });

  it('refuses the actor removing or omitting the deny row', async () => {
    const actorAbility = await abilityOf(users.actor.id);

    expect(
      await outcome(
        roleService.removePermissionFromRole(
          restrictRole.id,
          updateUser.id,
          actorAbility,
          users.actor.id
        )
      )
    ).toBe(liftRefused);
    expect(
      await outcome(
        roleService.setPermissionsForRole(
          restrictRole.id,
          [],
          actorAbility,
          users.actor.id
        )
      )
    ).toBe(liftRefused);
    expect(
      await dataSource
        .getRepository(RolePermission)
        .countBy({ roleId: restrictRole.id })
    ).toBe(1);
    expect(await canUpdateCeo(users.actor.id)).toBe(false);
  });

  it('keeps a deny row that a full replace sends back unchanged', async () => {
    const actorAbility = await abilityOf(users.actor.id);

    expect(
      await outcome(
        roleService.setPermissionsForRole(
          restrictRole.id,
          [{ permissionId: updateUser.id, conditions: denyCeo() }],
          actorAbility,
          users.actor.id
        )
      )
    ).toBe('RESOLVED');
    expect(await canUpdateCeo(users.actor.id)).toBe(false);
  });

  it('refuses the actor deleting the restriction role', async () => {
    const actorAbility = await abilityOf(users.actor.id);

    expect(
      await outcome(
        roleService.delete(restrictRole.id, actorAbility, users.actor.id)
      )
    ).toBe(liftRefused);
    expect(
      await dataSource.getRepository(Role).countBy({ id: restrictRole.id })
    ).toBe(1);
  });

  it('refuses the actor handing a plain allow to an accomplice', async () => {
    const actorAbility = await abilityOf(users.actor.id);

    expect(
      await outcome(
        roleService.setPermissionsForRole(
          accompliceRole.id,
          [{ permissionId: updateUser.id }],
          actorAbility,
          users.actor.id
        )
      )
    ).toBe(grantRefused);
    expect(
      await outcome(
        roleService.assignRoleToUser(
          users.accomplice.id,
          adminRole.id,
          actorAbility,
          users.actor.id
        )
      )
    ).toBe(grantRefused);
    expect(await canUpdateCeo(users.accomplice.id)).toBe(false);
  });

  it('lets an unrestricted admin lift the restriction on every path', async () => {
    const adminAbility = await abilityOf(users.unrestricted.id);
    const actingId = users.unrestricted.id;

    expect(
      await outcome(
        roleService.removeRoleFromUser(
          users.actor.id,
          restrictRole.id,
          adminAbility,
          actingId
        )
      )
    ).toBe('RESOLVED');
    expect(await canUpdateCeo(users.actor.id)).toBe(true);

    expect(
      await outcome(
        roleService.removePermissionFromRole(
          restrictRole.id,
          updateUser.id,
          adminAbility,
          actingId
        )
      )
    ).toBe('RESOLVED');

    await roleService.setPermissionsForRole(restrictRole.id, [
      { permissionId: updateUser.id, conditions: denyCeo() }
    ]);
    expect(
      await outcome(
        roleService.setPermissionsForRole(
          restrictRole.id,
          [],
          adminAbility,
          actingId
        )
      )
    ).toBe('RESOLVED');

    await roleService.setPermissionsForRole(restrictRole.id, [
      { permissionId: updateUser.id, conditions: denyCeo() }
    ]);
    expect(
      await outcome(roleService.delete(restrictRole.id, adminAbility, actingId))
    ).toBe('RESOLVED');
  });
});
