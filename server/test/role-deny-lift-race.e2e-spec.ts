import { HttpException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, EntityManager, In } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import type { PermissionCondition } from '@app/shared/types';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import type { AppAbility } from '../src/modules/auth/casl/app-ability';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { User } from '../src/modules/users/entities/user.entity';

// A restricted admin passes the deny-lift check, then another request changes
// the role before the write transaction starts. The write must read the role
// rows again under its lock.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Role writes against a concurrent grant change (e2e)', () => {
  const tag = `deny-lift-race-${Date.now()}`;
  let app: INestApplication;
  let dataSource: DataSource;
  let roleService: RoleService;
  let permissionService: PermissionService;
  let actor: User;
  let ceo: User;
  let member: User;
  let updateUser: Permission;
  const denyCeo = (): PermissionCondition => ({
    effect: 'deny',
    fieldMatch: { email: [ceo.email] }
  });
  const liftRefused = `403 ${ErrorKeys.ROLES.CANNOT_LIFT_DENY}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    roleService = app.get(RoleService);
    permissionService = app.get(PermissionService);
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

    const users = dataSource.getRepository(User);
    const createUser = (name: string): Promise<User> =>
      users.save(
        users.create({
          email: `${tag}-${name}@example.com`,
          name,
          isEmailVerified: true,
          password: null
        })
      );
    ceo = await createUser('ceo');
    actor = await createUser('actor');
    member = await createUser('member');

    const admin = await createRole('admin');
    await roleService.setPermissionsForRole(
      admin.id,
      [
        { permissionId: updateUser.id },
        { permissionId: find('update', 'Role').id },
        { permissionId: find('assign', 'Role').id },
        { permissionId: find('delete', 'Role').id }
      ],
      SYSTEM_ABILITY
    );
    const restrict = await createRole('restrict');
    await roleService.setPermissionsForRole(
      restrict.id,
      [{ permissionId: updateUser.id, conditions: denyCeo() }],
      SYSTEM_ABILITY
    );
    await roleService.assignRoleToUser(actor.id, admin.id, SYSTEM_ABILITY);
    await roleService.assignRoleToUser(actor.id, restrict.id, SYSTEM_ABILITY);
  }, 60000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(Role)
        .where('name LIKE :prefix', { prefix: `${tag}%` })
        .execute();
      await dataSource
        .getRepository(User)
        .delete({ email: In([ceo, actor, member].map((u) => u.email)) });
    }
    await app?.close();
  });

  function createRole(name: string): Promise<Role> {
    return roleService.create({ name: `${tag}-${name}` }, SYSTEM_ABILITY);
  }

  async function abilityOf(userId: string): Promise<AppAbility> {
    await permissionService.invalidateUserCache(userId);
    return app
      .get(CaslAbilityFactory)
      .createForUser(
        userId,
        await permissionService.getRolesForUser(userId),
        await permissionService.getPermissionsForUser(userId)
      );
  }

  /** Runs `change` after the checks, just before the first transaction. */
  function beforeFirstTransaction(change: () => Promise<unknown>): void {
    const original = EntityManager.prototype.transaction;
    let first = true;
    jest
      .spyOn(EntityManager.prototype, 'transaction')
      .mockImplementation(async function (
        this: EntityManager,
        ...args: Parameters<EntityManager['transaction']>
      ) {
        if (first) {
          first = false;
          await change();
        }
        return original.apply(this, args);
      });
  }

  async function outcome(run: Promise<unknown>): Promise<string> {
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
  }

  function addDeny(roleId: string): Promise<void> {
    return roleService.assignPermissionsToRole(
      roleId,
      [updateUser.id],
      denyCeo(),
      SYSTEM_ABILITY
    );
  }

  async function denyCount(roleId: string): Promise<number> {
    const rows: { n: number }[] = await dataSource.query(
      "SELECT count(*)::int AS n FROM role_permissions WHERE role_id = $1 AND conditions->>'effect' = 'deny'",
      [roleId]
    );
    return rows[0].n;
  }

  it('refuses a replace that would drop a deny added after the check', async () => {
    const role = await createRole('replace');
    const ability = await abilityOf(actor.id);
    beforeFirstTransaction(() => addDeny(role.id));

    expect(
      await outcome(
        roleService.setPermissionsForRole(role.id, [], ability, actor.id)
      )
    ).toBe(liftRefused);
    expect(await denyCount(role.id)).toBe(1);
  });

  it('refuses a role delete that would drop a deny added after the check', async () => {
    const role = await createRole('delete');
    const ability = await abilityOf(actor.id);
    beforeFirstTransaction(() => addDeny(role.id));

    expect(await outcome(roleService.delete(role.id, ability, actor.id))).toBe(
      liftRefused
    );
    expect(await dataSource.getRepository(Role).countBy({ id: role.id })).toBe(
      1
    );
  });

  it('refuses a grant removal when the grant became a deny after the check', async () => {
    const role = await createRole('remove');
    await roleService.setPermissionsForRole(
      role.id,
      [{ permissionId: updateUser.id }],
      SYSTEM_ABILITY
    );
    const ability = await abilityOf(actor.id);
    beforeFirstTransaction(() =>
      roleService.setPermissionsForRole(
        role.id,
        [{ permissionId: updateUser.id, conditions: denyCeo() }],
        SYSTEM_ABILITY
      )
    );

    expect(
      await outcome(
        roleService.removePermissionFromRole(
          role.id,
          updateUser.id,
          ability,
          actor.id
        )
      )
    ).toBe(liftRefused);
    expect(await denyCount(role.id)).toBe(1);
  });

  it('refuses a role removal from a user when the role gained a deny after the check', async () => {
    const role = await createRole('unassign');
    await roleService.assignRoleToUser(member.id, role.id, SYSTEM_ABILITY);
    const ability = await abilityOf(actor.id);
    beforeFirstTransaction(() => addDeny(role.id));

    expect(
      await outcome(
        roleService.removeRoleFromUser(member.id, role.id, ability, actor.id)
      )
    ).toBe(liftRefused);
    const held: unknown[] = await dataSource.query(
      'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2',
      [member.id, role.id]
    );
    expect(held).toHaveLength(1);
  });

  it('drops the cached grants of a user who got the role after the check', async () => {
    const role = await createRole('holder');
    await roleService.setPermissionsForRole(
      role.id,
      [{ permissionId: updateUser.id }],
      SYSTEM_ABILITY
    );
    beforeFirstTransaction(async () => {
      await roleService.assignRoleToUser(member.id, role.id, SYSTEM_ABILITY);
      expect(await permissionService.getRoleNamesForUser(member.id)).toContain(
        role.name
      );
    });

    await roleService.delete(role.id, SYSTEM_ABILITY);

    expect(
      await permissionService.getRoleNamesForUser(member.id)
    ).not.toContain(role.name);
  });
});
