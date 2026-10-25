import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  createMongoAbility,
  type AppAbility
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
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import { User } from '../src/modules/users/entities/user.entity';

// A read that queried before a change and writes the cache after the
// invalidation must not put the old value back.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY_MS = 86_400_000;

/**
 * Makes the next call of `method` resolve its real result only after
 * `release()`. `reached` resolves when the real query has returned.
 */
function holdNextCall<T extends object>(
  target: T,
  method: keyof T & string
): { reached: Promise<void>; release: () => void; restore: () => void } {
  let onReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => (onReached = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const original = target[method] as (...args: unknown[]) => Promise<unknown>;
  const spy = jest
    .spyOn(target, method as never)
    .mockImplementationOnce((async (...args: unknown[]) => {
      const result = await original.apply(target, args);
      onReached();
      await gate;
      return result;
    }) as never);
  return { reached, release, restore: () => spy.mockRestore() };
}

runWithInfra('A cache read that races an invalidation (e2e)', () => {
  const tag = `cache-race-${Date.now()}`;
  const email = `${tag}@example.com`;
  const planKey = `${tag}-plan`;
  const capability = `${tag}-cap`;
  const superAbility = createMongoAbility<AppAbility>([
    { action: 'manage', subject: 'all' }
  ]);

  let app: INestApplication;
  let dataSource: DataSource;
  let roleService: RoleService;
  let permissionService: PermissionService;
  let resourceService: ResourceService;
  let entitlements: EntitlementService;
  let holder: User;
  let deleteRole: Permission;
  const roleIds: string[] = [];
  let resourceId: string | undefined;
  let held: ReturnType<typeof holdNextCall> | undefined;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    roleService = app.get(RoleService);
    permissionService = app.get(PermissionService);
    resourceService = app.get(ResourceService);
    entitlements = app.get(EntitlementService);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);
    jest
      .spyOn(app.get(ResourceRegistryService), 'isRegistered')
      .mockReturnValue(true);

    const permission = (await dataSource.getRepository(Permission).find()).find(
      (p) => p.action.name === 'delete' && p.resource.subject === 'Role'
    );
    if (!permission) throw new Error('Permission delete:Role missing');
    deleteRole = permission;

    const userRepository = dataSource.getRepository(User);
    holder = await userRepository.save(
      userRepository.create({
        email,
        name: 'Cache Race',
        isEmailVerified: true,
        password: null
      })
    );
  }, 60000);

  afterEach(() => {
    // A gate that a failed case never consumed must not hold the next read.
    held?.release();
    held?.restore();
    held = undefined;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (dataSource) {
      if (roleIds.length > 0) {
        await dataSource.getRepository(Role).delete({ id: In(roleIds) });
      }
      if (resourceId) {
        await dataSource.getRepository(Resource).delete({ id: resourceId });
      }
      // The customer and its subscription go with the user (CASCADE).
      await dataSource.getRepository(User).delete({ email });
      await dataSource.getRepository(Plan).delete({ key: planKey });
    }
    await app?.close();
  });

  async function grantDeleteRole(): Promise<Role> {
    const role = await roleService.create(
      { name: `${tag}-${roleIds.length}` },
      SYSTEM_ABILITY
    );
    roleIds.push(role.id);
    await roleService.setPermissionsForRole(
      role.id,
      [{ permissionId: deleteRole.id }],
      SYSTEM_ABILITY
    );
    await roleService.assignRoleToUser(holder.id, role.id, SYSTEM_ABILITY);
    return role;
  }

  it('keeps a revoked permission out of the cache', async () => {
    const role = await grantDeleteRole();
    const users = app.get<Repository<User>>(getRepositoryToken(User));
    held = holdNextCall(users, 'findOne');

    const reader = permissionService.getPermissionsForUser(holder.id);
    await held.reached;
    await roleService.removePermissionFromRole(
      role.id,
      deleteRole.id,
      SYSTEM_ABILITY
    );
    held.release();
    expect((await reader).map((p) => p.permission)).toContain(
      `${deleteRole.resource.name}:delete`
    );

    const after = await permissionService.getPermissionsForUser(holder.id);
    expect(after.map((p) => p.permission)).not.toContain(
      `${deleteRole.resource.name}:delete`
    );
  });

  it('keeps a removed role out of the cache', async () => {
    const role = await grantDeleteRole();
    const users = app.get<Repository<User>>(getRepositoryToken(User));
    held = holdNextCall(users, 'findOne');

    const reader = permissionService.getRolesForUser(holder.id);
    await held.reached;
    await roleService.removeRoleFromUser(holder.id, role.id, SYSTEM_ABILITY);
    held.release();
    expect((await reader).map((r) => r.name)).toContain(role.name);

    const after = await permissionService.getRolesForUser(holder.id);
    expect(after.map((r) => r.name)).not.toContain(role.name);
  });

  it('keeps a narrowed action out of the subject maps', async () => {
    const actions = await dataSource
      .getRepository(Action)
      .findBy({ name: In(['read', 'delete']) });
    expect(actions).toHaveLength(2);
    const resourceRepository = dataSource.getRepository(Resource);
    const resource = await resourceRepository.save(
      resourceRepository.create({
        name: tag,
        subject: `CacheRace${Date.now()}`,
        displayName: 'Cache race probe',
        actionNames: ['read', 'delete'],
        conditionalActionNames: [],
        allowedActionNames: null
      })
    );
    resourceId = resource.id;
    await resourceService.invalidateSubjectMapCache();

    const resources = app.get<Repository<Resource>>(
      getRepositoryToken(Resource)
    );
    held = holdNextCall(resources, 'find');

    const reader = resourceService.getSubjectMaps();
    await held.reached;
    await resourceService.update(
      resource.id,
      { allowedActionNames: ['read'] },
      superAbility
    );
    held.release();
    expect((await reader).grantableActions[tag]).toEqual(['read', 'delete']);

    const after = await resourceService.getSubjectMaps();
    expect(after.grantableActions[tag]).toEqual(['read']);
  });

  it('keeps the entitlements of a canceled plan out of the cache', async () => {
    await dataSource.getRepository(Plan).save(
      dataSource.getRepository(Plan).create({
        key: planKey,
        name: planKey,
        description: null,
        billingMode: 'fixed',
        interval: 'month',
        meterKey: null,
        entitlements: [capability],
        limits: null,
        trialDays: 0,
        active: true,
        prices: { paddle: { currency: 'USD', amountMinor: 1000 } }
      })
    );
    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        userId: holder.id,
        provider: 'paddle',
        providerOverride: null,
        providerCustomerId: `ctm_${tag}`,
        country: 'US',
        currency: 'USD',
        defaultPaymentMethodId: null
      })
    );
    const subscriptionRepository = dataSource.getRepository(Subscription);
    const subscription = await subscriptionRepository.save(
      subscriptionRepository.create({
        customerId: customer.id,
        planKey,
        provider: 'paddle',
        billingMode: 'fixed',
        status: 'active',
        lifecycleOwner: 'provider',
        currentPeriodStart: new Date(Date.now() - DAY_MS),
        currentPeriodEnd: new Date(Date.now() + 29 * DAY_MS),
        billingAnchorAt: null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: `sub_${tag}`,
        paymentMethodId: null
      })
    );

    const subscriptions = app.get<Repository<Subscription>>(
      getRepositoryToken(Subscription)
    );
    held = holdNextCall(subscriptions, 'findOne');

    const reader = entitlements.capabilitiesFor(holder.id);
    await held.reached;
    await subscriptionRepository.update(
      { id: subscription.id },
      { status: 'canceled' }
    );
    await entitlements.invalidateUser(holder.id);
    held.release();
    expect((await reader).capabilities).toContain(capability);

    const after = await entitlements.capabilitiesFor(holder.id);
    expect(after.planKey).not.toBe(planKey);
    expect(after.capabilities).not.toContain(capability);
  });
});
