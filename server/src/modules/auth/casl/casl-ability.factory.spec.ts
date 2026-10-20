import { CaslAbilityFactory } from './casl-ability.factory';
import type { RoleInfo } from '../services/permission.service';
import { ResolvedPermission } from '@app/shared/types';

// The rule compilation itself is covered by
// `src/common/utils/ability-rules.spec.ts`; these cases cover the wiring.
describe('CaslAbilityFactory', () => {
  let factory: CaslAbilityFactory;
  let resourceService: { getSubjectMaps: jest.Mock };
  let permissionService: {
    getRolesForUser: jest.Mock;
    getPermissionsForUser: jest.Mock;
  };

  beforeEach(() => {
    resourceService = {
      getSubjectMaps: jest.fn().mockResolvedValue({
        active: { users: 'User', roles: 'Role' },
        orphaned: {},
        grantableActions: { users: ['read', 'delete'], roles: ['read'] },
        conditionalActions: {}
      })
    };
    permissionService = {
      getRolesForUser: jest.fn().mockResolvedValue([]),
      getPermissionsForUser: jest.fn().mockResolvedValue([])
    };
    factory = new CaslAbilityFactory(
      // @ts-expect-error testing mocks — only getSubjectMaps and the two loads are needed
      resourceService,
      permissionService
    );
  });

  describe('resolveForUser', () => {
    it('should build the ability from the roles and permissions of the user', async () => {
      const roles: RoleInfo[] = [{ name: 'viewer', isSuper: false }];
      const permissions: ResolvedPermission[] = [
        {
          resource: 'users',
          action: 'read',
          permission: 'users:read',
          conditions: null
        }
      ];
      permissionService.getRolesForUser.mockResolvedValue(roles);
      permissionService.getPermissionsForUser.mockResolvedValue(permissions);

      const resolved = await factory.resolveForUser('user-1');

      expect(permissionService.getRolesForUser).toHaveBeenCalledWith('user-1');
      expect(permissionService.getPermissionsForUser).toHaveBeenCalledWith(
        'user-1'
      );
      expect(resolved.roles).toBe(roles);
      expect(resolved.permissions).toBe(permissions);
      expect(resolved.ability.can('read', 'User')).toBe(true);
      expect(resolved.ability.can('delete', 'User')).toBe(false);
      expect(resolved.ability.can('read', 'Role')).toBe(false);
    });

    it('should grant full access when a role of the user is super', async () => {
      permissionService.getRolesForUser.mockResolvedValue([
        { name: 'admin', isSuper: true }
      ]);

      const { ability } = await factory.resolveForUser('user-1');

      expect(ability.can('manage', 'all')).toBe(true);
      expect(resourceService.getSubjectMaps).not.toHaveBeenCalled();
    });
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
});
