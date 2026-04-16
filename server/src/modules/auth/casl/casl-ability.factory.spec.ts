import { Logger } from '@nestjs/common';
import { CaslAbilityFactory, RoleInfo } from './casl-ability.factory';
import { ResolvedPermission } from '@app/shared/types';

const MOCK_SUBJECT_MAP: Record<string, string> = {
  users: 'User',
  roles: 'Role',
  permissions: 'Permission',
  profile: 'Profile'
};

describe('CaslAbilityFactory', () => {
  let factory: CaslAbilityFactory;
  let resourceService: { getSubjectMap: jest.Mock };

  beforeEach(() => {
    resourceService = {
      getSubjectMap: jest.fn().mockResolvedValue(MOCK_SUBJECT_MAP)
    };
    // @ts-expect-error testing mock — only getSubjectMap is needed
    factory = new CaslAbilityFactory(resourceService);
  });

  it('should grant super role full access to all subjects', async () => {
    const roles: RoleInfo[] = [{ name: 'admin', isSuper: true }];
    const ability = await factory.createForUser('user-1', roles, []);

    expect(ability.can('manage', 'all')).toBe(true);
    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(true);
  });

  it('should not grant full access for non-super role named admin', async () => {
    const roles: RoleInfo[] = [{ name: 'admin', isSuper: false }];
    const ability = await factory.createForUser('user-1', roles, []);

    expect(ability.can('manage', 'all')).toBe(false);
  });

  it('should grant permission without conditions', async () => {
    const roles: RoleInfo[] = [{ name: 'viewer', isSuper: false }];
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: null
      }
    ];

    const ability = await factory.createForUser('user-1', roles, permissions);

    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(false);
  });

  it('should use userField from ownership condition as the condition key', async () => {
    const roles: RoleInfo[] = [{ name: 'editor', isSuper: false }];
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'update',
        permission: 'users:update:own',
        conditions: { ownership: { userField: 'createdBy' } }
      }
    ];

    const ability = await factory.createForUser('user-1', roles, permissions);

    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        createdBy: 'user-1'
      } as never)
    ).toBe(true);
    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        createdBy: 'user-2'
      } as never)
    ).toBe(false);
  });

  it('should use "id" field when userField is "id"', async () => {
    const roles: RoleInfo[] = [{ name: 'editor', isSuper: false }];
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'update',
        permission: 'users:update:own',
        conditions: { ownership: { userField: 'id' } }
      }
    ];

    const ability = await factory.createForUser('user-1', roles, permissions);

    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        id: 'user-1'
      } as never)
    ).toBe(true);
    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        id: 'user-2'
      } as never)
    ).toBe(false);
  });

  it('should skip permissions for unknown resources and log a warning', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const roles: RoleInfo[] = [{ name: 'viewer', isSuper: false }];

    const permissions: ResolvedPermission[] = [
      {
        resource: 'unknown-resource',
        action: 'read',
        permission: 'unknown:read',
        conditions: null
      }
    ];

    const ability = await factory.createForUser('user-1', roles, permissions);

    expect(ability.can('read', 'User')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown-resource')
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('user-1'));

    warnSpy.mockRestore();
  });

  it('should handle multiple permissions for different resources', async () => {
    const roles: RoleInfo[] = [{ name: 'viewer', isSuper: false }];
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: null
      },
      {
        resource: 'roles',
        action: 'search',
        permission: 'roles:search',
        conditions: null
      }
    ];

    const ability = await factory.createForUser('user-1', roles, permissions);

    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('search', 'Role')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(false);
  });

  it('should apply safe custom conditions as MongoQuery', async () => {
    const roles: RoleInfo[] = [{ name: 'editor', isSuper: false }];
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: { custom: '{"status":{"$in":["active","pending"]}}' }
      }
    ];

    const ability = await factory.createForUser('user-1', roles, permissions);

    expect(
      ability.can('read', {
        __caslSubjectType__: 'User',
        status: 'active'
      } as never)
    ).toBe(true);
    expect(
      ability.can('read', {
        __caslSubjectType__: 'User',
        status: 'deleted'
      } as never)
    ).toBe(false);
  });

  it('should skip custom conditions containing $where and log a warning', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const roles: RoleInfo[] = [{ name: 'editor', isSuper: false }];
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: { custom: '{"$where":"function(){return true}"}' }
      }
    ];

    const ability = await factory.createForUser('user-1', roles, permissions);

    // $where block skipped → no conditions applied → unconditional deny
    expect(ability.can('read', 'User')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('$where'));

    warnSpy.mockRestore();
  });

  it('should skip custom conditions containing nested $where', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const roles: RoleInfo[] = [{ name: 'editor', isSuper: false }];
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: {
          custom: '{"$or":[{"status":"active"},{"$where":"hack"}]}'
        }
      }
    ];

    const ability = await factory.createForUser('user-1', roles, permissions);

    expect(ability.can('read', 'User')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('$where'));

    warnSpy.mockRestore();
  });

  it('should skip custom conditions containing __proto__', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const roles: RoleInfo[] = [{ name: 'editor', isSuper: false }];
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: { custom: '{"__proto__":{"admin":true}}' }
      }
    ];

    const ability = await factory.createForUser('user-1', roles, permissions);

    expect(ability.can('read', 'User')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__proto__'));

    warnSpy.mockRestore();
  });
});
