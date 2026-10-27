import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import {
  createMongoAbility,
  type AppAbility,
  type Subjects
} from '../src/modules/auth/casl/app-ability';
import { Action } from '../src/modules/auth/entities/action.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { ResourceRegistryService } from '../src/modules/auth/services/resource-registry.service';
import { ResourceService } from '../src/modules/auth/services/resource.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { User } from '../src/modules/users/entities/user.entity';

// A narrowed or orphaned action keeps its role rows, so offering it again
// wakes the dormant grants, the caller's own included.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Offering a resource action again (e2e)', () => {
  const tag = `widen-${Date.now()}`;
  const probeSubject = `WidenProbe${Date.now()}`;
  const actorEmail = `${tag}-actor@example.com`;

  let app: INestApplication;
  let dataSource: DataSource;
  let resourceService: ResourceService;
  let roleService: RoleService;
  let permissionService: PermissionService;
  let abilityFactory: CaslAbilityFactory;

  let actor: User;
  let resource: Resource;
  const superAbility = createMongoAbility<AppAbility>([
    { action: 'manage', subject: 'all' }
  ]);

  const abilityOf = async (userId: string): Promise<AppAbility> => {
    await permissionService.invalidateUserCache(userId);
    return abilityFactory.createForUser(
      userId,
      await permissionService.getRolesForUser(userId),
      await permissionService.getPermissionsForUser(userId)
    );
  };

  // The startup sync of a parallel suite orphans this unregistered resource
  // at any moment, so only an ability check that expects false is stable.
  // A woken grant is asserted on the offered actions that buildAbility reads.
  const actorCanDelete = async (): Promise<boolean> =>
    (await abilityOf(actor.id)).can('delete', probeSubject as Subjects);

  const offered = async (): Promise<string[] | undefined> =>
    (await resourceService.getSubjectMaps()).grantableActions[tag];

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

  const widenRefused = `403 ${ErrorKeys.RESOURCES.CANNOT_WIDEN}`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    resourceService = app.get(ResourceService);
    roleService = app.get(RoleService);
    permissionService = app.get(PermissionService);
    abilityFactory = app.get(CaslAbilityFactory);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);
    jest
      .spyOn(app.get(ResourceRegistryService), 'isRegistered')
      .mockReturnValue(true);

    const actions = await dataSource
      .getRepository(Action)
      .findBy({ name: In(['read', 'delete']) });
    const action = (name: string): Action => {
      const found = actions.find((a) => a.name === name);
      if (!found) throw new Error(`Action ${name} missing`);
      return found;
    };

    const resourceRepository = dataSource.getRepository(Resource);
    resource = await resourceRepository.save(
      resourceRepository.create({
        name: tag,
        subject: probeSubject,
        displayName: 'Widen probe',
        actionNames: ['read', 'delete'],
        conditionalActionNames: [],
        allowedActionNames: null
      })
    );
    await resourceService.invalidateSubjectMapCache();

    const permissionRepository = dataSource.getRepository(Permission);
    const deleteProbe = await permissionRepository.save(
      permissionRepository.create({
        resourceId: resource.id,
        actionId: action('delete').id
      })
    );
    const updatePermission = (await permissionRepository.find()).find(
      (p) => p.action.name === 'update' && p.resource.subject === 'Permission'
    );
    if (!updatePermission) throw new Error('update:Permission missing');

    const userRepository = dataSource.getRepository(User);
    actor = await userRepository.save(
      userRepository.create({
        email: actorEmail,
        name: 'Widen Actor',
        isEmailVerified: true,
        password: null
      })
    );

    // The grant is written while the action is offered; the narrowing then
    // leaves its row dormant.
    const role = await roleService.create(
      { name: `${tag}-admin` },
      SYSTEM_ABILITY
    );
    await roleService.setPermissionsForRole(
      role.id,
      [{ permissionId: updatePermission.id }, { permissionId: deleteProbe.id }],
      SYSTEM_ABILITY
    );
    await roleService.assignRoleToUser(actor.id, role.id, SYSTEM_ABILITY);
    await resourceService.update(
      resource.id,
      { allowedActionNames: ['read'] },
      superAbility
    );
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.getRepository(Role).delete({ name: `${tag}-admin` });
      await dataSource.getRepository(User).delete({ email: actorEmail });
      if (resource) {
        await dataSource
          .getRepository(Permission)
          .delete({ resourceId: resource.id });
        await dataSource.getRepository(Resource).delete({ id: resource.id });
      }
    }
    await app?.close();
  });

  it('starts with the grant dormant', async () => {
    expect(await offered()).toEqual(['read']);
    expect(await actorCanDelete()).toBe(false);
  });

  it('refuses the actor offering the dormant action again', async () => {
    const actorAbility = await abilityOf(actor.id);

    for (const allowedActionNames of [['read', 'delete'], null]) {
      expect(
        await outcome(
          resourceService.update(
            resource.id,
            { allowedActionNames },
            actorAbility
          )
        )
      ).toBe(widenRefused);
    }
    expect(await offered()).toEqual(['read']);
    expect(await actorCanDelete()).toBe(false);
  });

  it('lets the actor narrow further', async () => {
    const actorAbility = await abilityOf(actor.id);

    expect(
      await outcome(
        resourceService.update(
          resource.id,
          { allowedActionNames: [] },
          actorAbility
        )
      )
    ).toBe('RESOLVED');
    expect(await offered()).toEqual([]);
    await resourceService.update(
      resource.id,
      { allowedActionNames: ['read'] },
      superAbility
    );
  });

  it('lets a super caller offer the action again', async () => {
    expect(
      await outcome(
        resourceService.update(
          resource.id,
          { allowedActionNames: null },
          superAbility
        )
      )
    ).toBe('RESOLVED');
    expect(await offered()).toEqual(['read', 'delete']);
  });

  it('refuses the actor restoring the orphaned resource, and lets a super caller', async () => {
    await dataSource
      .getRepository(Resource)
      .update({ id: resource.id }, { isOrphaned: true });
    await resourceService.invalidateSubjectMapCache();
    expect(await actorCanDelete()).toBe(false);

    expect(
      await outcome(
        resourceService.restore(resource.id, await abilityOf(actor.id))
      )
    ).toBe(widenRefused);
    expect(await actorCanDelete()).toBe(false);

    const restored = await resourceService.restore(resource.id, superAbility);
    expect(restored.isOrphaned).toBe(false);
  });

  // The `users` resource is registered by every suite, so no parallel startup
  // sync orphans it, and these cases do not change it.
  describe('a restore of a resource that is not orphaned', () => {
    const notOrphaned = `409 ${ErrorKeys.RESOURCES.NOT_ORPHANED}`;
    const restoreRows = (): number =>
      jest
        .mocked(app.get(AuditService).log)
        .mock.calls.filter(
          ([row]) => row.action === AuditAction.RESOURCE_RESTORE
        ).length;
    const usersResource = (): Promise<Resource> =>
      dataSource.getRepository(Resource).findOneByOrFail({ name: 'users' });
    const audit = (id: string) => ({
      action: AuditAction.RESOURCE_RESTORE,
      targetId: id,
      targetType: 'Resource'
    });

    it('is refused with no audit row', async () => {
      const users = await usersResource();
      const before = restoreRows();

      expect(
        await outcome(
          resourceService.restore(
            users.id,
            superAbility,
            undefined,
            audit(users.id)
          )
        )
      ).toBe(notOrphaned);
      expect(restoreRows()).toBe(before);
    });

    it('is refused after a stale read, as the loser of two concurrent restores is', async () => {
      const users = await usersResource();
      expect(users.isOrphaned).toBe(false);
      jest
        .spyOn(
          app.get<Repository<Resource>>(getRepositoryToken(Resource)),
          'findOne'
        )
        .mockResolvedValueOnce({ ...users, isOrphaned: true });
      const before = restoreRows();

      expect(
        await outcome(
          resourceService.restore(
            users.id,
            SYSTEM_ABILITY,
            undefined,
            audit(users.id)
          )
        )
      ).toBe(notOrphaned);
      expect(restoreRows()).toBe(before);
      expect((await usersResource()).isOrphaned).toBe(false);
    });
  });
});
