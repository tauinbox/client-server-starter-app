import { Logger } from '@nestjs/common';
import { CaslAbilityFactory } from './casl-ability.factory';
import { ResolvedPermission } from '@app/shared/types';

describe('CaslAbilityFactory', () => {
  let factory: CaslAbilityFactory;

  beforeEach(() => {
    factory = new CaslAbilityFactory();
  });

  it('should grant admin full access to all subjects', () => {
    const ability = factory.createForUser('user-1', ['admin'], []);

    expect(ability.can('manage', 'all')).toBe(true);
    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(true);
  });

  it('should grant permission without conditions', () => {
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: null
      }
    ];

    const ability = factory.createForUser('user-1', ['viewer'], permissions);

    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(false);
  });

  it('should use userField from ownership condition as the condition key', () => {
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'update',
        permission: 'users:update:own',
        conditions: { ownership: { userField: 'createdBy' } }
      }
    ];

    const ability = factory.createForUser('user-1', ['editor'], permissions);

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

  it('should use "id" field when userField is "id"', () => {
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'update',
        permission: 'users:update:own',
        conditions: { ownership: { userField: 'id' } }
      }
    ];

    const ability = factory.createForUser('user-1', ['editor'], permissions);

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

  it('should skip permissions for unknown resources and log a warning', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const permissions: ResolvedPermission[] = [
      {
        resource: 'unknown-resource',
        action: 'read',
        permission: 'unknown:read',
        conditions: null
      }
    ];

    const ability = factory.createForUser('user-1', ['viewer'], permissions);

    expect(ability.can('read', 'User')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown-resource')
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('user-1'));

    warnSpy.mockRestore();
  });

  it('should handle multiple permissions for different resources', () => {
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: null
      },
      {
        resource: 'roles',
        action: 'list',
        permission: 'roles:list',
        conditions: null
      }
    ];

    const ability = factory.createForUser('user-1', ['viewer'], permissions);

    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('list', 'Role')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(false);
  });
});
