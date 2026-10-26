import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { subject } from '@casl/ability';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { User } from '../src/modules/users/entities/user.entity';

// Before the write-time IsObject check, an array could be stored as the
// condition of a grant; such a row must fail closed in both directions.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('A grant condition stored as an array (e2e)', () => {
  const tag = `array-condition-${Date.now()}`;

  let app: INestApplication;
  let dataSource: DataSource;
  let roleService: RoleService;
  let permissionService: PermissionService;
  let abilityFactory: CaslAbilityFactory;
  let updateUser: Permission;
  let target: User;

  const createUser = (name: string): Promise<User> => {
    const users = dataSource.getRepository(User);
    return users.save(
      users.create({
        email: `${tag}-${name}@example.com`,
        name,
        isEmailVerified: true,
        password: null
      })
    );
  };

  const giveGrant = async (user: User, conditions: unknown): Promise<void> => {
    const role = await roleService.create(
      { name: `${tag}-${user.name}-${Math.random()}` },
      SYSTEM_ABILITY
    );
    await dataSource.getRepository(RolePermission).insert({
      roleId: role.id,
      permissionId: updateUser.id,
      // @ts-expect-error -- a stored row can hold what the type forbids
      conditions
    });
    await roleService.assignRoleToUser(user.id, role.id, SYSTEM_ABILITY);
  };

  const canUpdateTarget = async (user: User): Promise<boolean> => {
    await permissionService.invalidateUserCache(user.id);
    const ability = await abilityFactory.createForUser(
      user.id,
      await permissionService.getRolesForUser(user.id),
      await permissionService.getPermissionsForUser(user.id)
    );
    return ability.can('update', subject('User', target));
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
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

    const found = (await dataSource.getRepository(Permission).find()).find(
      (p) => p.action.name === 'update' && p.resource.subject === 'User'
    );
    if (!found) throw new Error('Permission update:User missing');
    updateUser = found;
    target = await createUser('target');
  });

  afterAll(async () => {
    await app.close();
  });

  it('grants nothing for a restriction stored in an array', async () => {
    const actor = await createUser('narrow');
    await giveGrant(actor, [{ fieldMatch: { email: ['nobody@example.com'] } }]);

    expect(await canUpdateTarget(actor)).toBe(false);
  });

  it('denies everything for a deny stored in an array', async () => {
    const actor = await createUser('denied');
    await giveGrant(actor, null);
    expect(await canUpdateTarget(actor)).toBe(true);

    await giveGrant(actor, [{ effect: 'deny' }]);

    expect(await canUpdateTarget(actor)).toBe(false);
  });
});
