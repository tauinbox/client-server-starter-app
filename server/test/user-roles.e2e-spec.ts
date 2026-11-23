import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import {
  addUserRole,
  attachRoles,
  findUserWithRoles
} from '../src/modules/users/utils/user-roles';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { isUniqueViolation } from '../src/common/utils/is-unique-violation.util';

// The roles of a user are read in two queries with no join, because the roles
// are settings and the memberships are personal data. These cases run on the
// real schema, which a mocked manager cannot show.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('User roles read without a join (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let permissions: PermissionService;
  let users: UsersService;
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const roleIds: string[] = [];
  let grant: Permission;

  const saveUser = async (name: string): Promise<User> => {
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({
        email: `user-roles-${name}-${tag}@example.com`,
        name: 'Roles Probe',
        isEmailVerified: true,
        password: null
      })
    );

    userIds.push(user.id);

    return user;
  };
  const saveRole = async (name: string): Promise<Role> => {
    const role = await dataSource
      .getRepository(Role)
      .save({ name: `${name}-${tag}` });

    roleIds.push(role.id);

    return role;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    permissions = app.get(PermissionService);
    users = app.get(UsersService);
    [grant] = await dataSource.getRepository(Permission).find({
      relations: { resource: true, action: true },
      take: 1
    });
  });

  afterAll(async () => {
    if (roleIds.length > 0) {
      await dataSource?.getRepository(Role).delete(roleIds);
    }

    if (userIds.length > 0) {
      await dataSource?.getRepository(User).delete(userIds);
    }

    await app?.close();
  });

  it('sets the roles of each user, sorted by name, and none on a user with no row', async () => {
    const holder = await saveUser('holder');
    const empty = await saveUser('empty');
    const zeta = await saveRole('zeta');
    const alpha = await saveRole('alpha');

    await addUserRole(dataSource.manager, {
      userId: holder.id,
      roleId: zeta.id
    });
    await addUserRole(dataSource.manager, {
      userId: holder.id,
      roleId: alpha.id
    });
    await attachRoles(dataSource.manager, [holder, empty]);

    expect(holder.roles.map(({ id }) => id)).toEqual([alpha.id, zeta.id]);
    expect(empty.roles).toEqual([]);
  });

  it('loads the relations of each role that the caller names', async () => {
    const user = await saveUser('relations');
    const role = await saveRole('granted');

    await dataSource
      .getRepository(RolePermission)
      .save({ roleId: role.id, permissionId: grant.id, conditions: null });
    await addUserRole(dataSource.manager, { userId: user.id, roleId: role.id });
    await attachRoles(dataSource.manager, [user], {
      rolePermissions: { permission: { resource: true, action: true } }
    });

    const [{ rolePermissions }] = user.roles;

    expect(
      rolePermissions.map(({ permission }) => permission.action.name)
    ).toEqual([grant.action.name]);
  });

  it('finds no soft-deleted user unless the caller asks for one', async () => {
    const user = await saveUser('deleted');
    const role = await saveRole('kept');

    await addUserRole(dataSource.manager, { userId: user.id, roleId: role.id });
    await dataSource.getRepository(User).softDelete(user.id);

    await expect(
      findUserWithRoles(dataSource.manager, { where: { id: user.id } })
    ).resolves.toBeNull();

    const found = await findUserWithRoles(dataSource.manager, {
      where: { id: user.id },
      withDeleted: true
    });

    expect(found?.roles.map(({ id }) => id)).toEqual([role.id]);
  });

  it('refuses a role that the user already holds with a unique violation', async () => {
    const user = await saveUser('twice');
    const role = await saveRole('twice');

    await addUserRole(dataSource.manager, { userId: user.id, roleId: role.id });

    const error = await addUserRole(dataSource.manager, {
      userId: user.id,
      roleId: role.id
    }).catch((caught: unknown) => caught);

    expect(isUniqueViolation(error)).toBe(true);
  });

  it('filterGrantHolders keeps a super holder and an allow holder, and drops the rest', async () => {
    const superHolder = await saveUser('super');
    const allowHolder = await saveUser('allow');
    const plainHolder = await saveUser('plain');
    const deletedSuper = await saveUser('gone');
    // A partial unique index allows one super role, which the migrations
    // already created.
    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    const allowRole = await saveRole('allow');
    const plainRole = await saveRole('plain');

    await dataSource
      .getRepository(RolePermission)
      .save({ roleId: allowRole.id, permissionId: grant.id, conditions: null });

    for (const [userId, roleId] of [
      [superHolder.id, superRole.id],
      [allowHolder.id, allowRole.id],
      [plainHolder.id, plainRole.id],
      [deletedSuper.id, superRole.id]
    ]) {
      await addUserRole(dataSource.manager, { userId, roleId });
    }

    await dataSource.getRepository(User).softDelete(deletedSuper.id);

    const held = await permissions.filterGrantHolders(
      [
        superHolder.id,
        allowHolder.id,
        plainHolder.id,
        deletedSuper.id,
        randomUUID()
      ],
      grant.action.name,
      grant.resource.subject
    );

    expect(held.toSorted()).toEqual(
      [superHolder.id, allowHolder.id].toSorted()
    );
  });

  it('the users list filters by role name and returns each user with its roles', async () => {
    const member = await saveUser('list-member');
    const other = await saveUser('list-other');
    const listed = await saveRole('listed');
    const extra = await saveRole('extra');

    await addUserRole(dataSource.manager, {
      userId: member.id,
      roleId: listed.id
    });
    await addUserRole(dataSource.manager, {
      userId: member.id,
      roleId: extra.id
    });
    await addUserRole(dataSource.manager, {
      userId: other.id,
      roleId: extra.id
    });

    const page = (role: string) =>
      users.findCursorPaginated(
        {
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          email: tag,
          role
        },
        SYSTEM_ABILITY
      );
    const { data } = await page(listed.name);

    expect(data.map(({ id }) => id)).toEqual([member.id]);
    expect(data[0].roles.map(({ id }) => id).toSorted()).toEqual(
      [listed.id, extra.id].toSorted()
    );
    await expect(page(`missing-${tag}`)).resolves.toMatchObject({ data: [] });
  });
});
