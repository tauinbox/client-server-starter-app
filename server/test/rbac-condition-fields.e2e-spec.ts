import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { subject } from '@casl/ability';
import { DataSource, In } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { User } from '../src/modules/users/entities/user.entity';

// A deny on a misspelt field matched no record, so it denied nothing. A
// stored row is written straight to the table, as data from before the write
// check would be. Runs only when DB_HOST is set.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Grant condition fields (e2e)', () => {
  const tag = `cond-fields-${Date.now()}`;
  const emails = {
    actor: `${tag}-actor@example.com`,
    target: `${tag}-target@example.com`
  };

  let app: INestApplication;
  let dataSource: DataSource;
  let roleService: RoleService;
  let permissionService: PermissionService;
  let abilityFactory: CaslAbilityFactory;
  let readUser: Permission;
  let role: Role;
  const users = {} as Record<keyof typeof emails, User>;

  const canReadTarget = async (): Promise<boolean> => {
    const userId = users.actor.id;
    await permissionService.invalidateUserCache(userId);
    const ability = await abilityFactory.createForUser(
      userId,
      await permissionService.getRolesForUser(userId),
      await permissionService.getPermissionsForUser(userId)
    );
    return ability.can('read', subject('User', users.target));
  };

  const storeRows = async (
    conditions: RolePermission['conditions'][]
  ): Promise<void> => {
    const repository = dataSource.getRepository(RolePermission);
    await repository.delete({ roleId: role.id });
    await repository.save(
      conditions.map((c) =>
        repository.create({
          roleId: role.id,
          permissionId: readUser.id,
          conditions: c
        })
      )
    );
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
    const found = permissions.find(
      (p) => p.action.name === 'read' && p.resource.subject === 'User'
    );
    if (!found) throw new Error('Permission read:User missing');
    readUser = found;

    const userRepository = dataSource.getRepository(User);
    for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
      users[key] = await userRepository.save(
        userRepository.create({
          email: emails[key],
          firstName: 'Cond',
          lastName: key === 'target' ? 'Typo' : 'Actor',
          isEmailVerified: true,
          password: null
        })
      );
    }

    role = await roleService.create({ name: `${tag}-role` });
    await roleService.assignRoleToUser(users.actor.id, role.id);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.getRepository(Role).delete({ name: `${tag}-role` });
      await dataSource
        .getRepository(User)
        .delete({ email: In(Object.values(emails)) });
    }
    await app?.close();
  });

  it('refuses to store a condition on a field the subject does not allow', async () => {
    const outcome = await roleService
      .setPermissionsForRole(role.id, [
        {
          permissionId: readUser.id,
          conditions: { fieldMatch: { password: ['x'] } }
        }
      ])
      .then(
        () => 'RESOLVED',
        (error: unknown) => {
          if (!(error instanceof HttpException)) throw error;
          const body = error.getResponse() as { errorKey?: string };
          return `${error.getStatus()} ${body.errorKey}`;
        }
      );

    expect(outcome).toBe(`400 ${ErrorKeys.ROLES.CONDITION_FIELD_UNKNOWN}`);
    expect(
      await dataSource
        .getRepository(RolePermission)
        .countBy({ roleId: role.id })
    ).toBe(0);
  });

  it('reads the target under an unconditional allow', async () => {
    await storeRows([null]);

    expect(await canReadTarget()).toBe(true);
  });

  it('turns a stored deny on a misspelt field into a blanket deny', async () => {
    await storeRows([{ effect: 'deny', fieldMatch: { lastname: ['Typo'] } }]);
    const allowRole = await roleService.create({ name: `${tag}-allow` });
    await roleService.setPermissionsForRole(allowRole.id, [
      { permissionId: readUser.id }
    ]);
    await roleService.assignRoleToUser(users.actor.id, allowRole.id);

    try {
      expect(await canReadTarget()).toBe(false);

      await storeRows([
        { effect: 'deny', fieldMatch: { lastName: ['Other'] } }
      ]);
      expect(await canReadTarget()).toBe(true);
    } finally {
      await dataSource.getRepository(Role).delete({ id: allowRole.id });
    }
  });
});
