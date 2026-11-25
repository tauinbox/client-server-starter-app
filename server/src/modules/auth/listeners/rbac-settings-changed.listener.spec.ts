import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { RbacSettingsChangedListener } from './rbac-settings-changed.listener';
import type { PermissionService } from '../services/permission.service';
import type { ResourceService } from '../services/resource.service';
import { RolePermissionsChangedEvent } from '../events/role-permissions-changed.event';
import { UserRole } from '../../users/entities/user-role.entity';
import { settingsChangedEvent } from '../../core/settings-change-log/testing/settings-changed-event';
import type { SettingsApplyScope } from '../../core/settings-change-log/settings-change.types';

describe('RbacSettingsChangedListener', () => {
  let permissionService: {
    findHolderIds: jest.Mock;
    invalidateUserCache: jest.Mock;
    invalidateAll: jest.Mock;
  };
  let resourceService: { invalidateSubjectMapCache: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let manager: { delete: jest.Mock; query: jest.Mock };
  let settings: { query: jest.Mock };
  let listener: RbacSettingsChangedListener;

  beforeEach(() => {
    permissionService = {
      findHolderIds: jest.fn().mockResolvedValue(['u-1', 'u-2']),
      invalidateUserCache: jest.fn().mockResolvedValue(undefined),
      invalidateAll: jest.fn().mockResolvedValue(undefined)
    };
    resourceService = {
      invalidateSubjectMapCache: jest.fn().mockResolvedValue(undefined)
    };
    eventEmitter = { emit: jest.fn() };
    manager = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      query: jest.fn().mockResolvedValue([])
    };
    settings = { query: jest.fn().mockResolvedValue([]) };
    listener = new RbacSettingsChangedListener(
      // @ts-expect-error partial mock: only the methods the listener calls
      permissionService as PermissionService,
      // @ts-expect-error partial mock: only the method the listener calls
      resourceService as ResourceService,
      // @ts-expect-error partial mock: only `emit`
      eventEmitter as EventEmitter2
    );
  });

  const run = (
    change: Parameters<typeof settingsChangedEvent>[0],
    scope: SettingsApplyScope = 'pool'
  ) =>
    listener.handleSettingsChanged(
      settingsChangedEvent(change, {
        managers: {
          // @ts-expect-error partial mock: only `delete` and `query`
          regional: manager as EntityManager,
          // @ts-expect-error partial mock: only `query`
          settings: settings as EntityManager
        },
        scope
      })
    );

  it('drops the lists of each holder of a changed role, read on the regional apply manager, and pushes to them', async () => {
    await run({ tables: ['role_permissions'], roleIds: ['r-1'] });

    expect(permissionService.findHolderIds).toHaveBeenCalledWith(manager, [
      'r-1'
    ]);
    expect(permissionService.invalidateUserCache.mock.calls).toEqual([
      ['u-1'],
      ['u-2']
    ]);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      RolePermissionsChangedEvent.name,
      new RolePermissionsChangedEvent(['u-1', 'u-2'])
    );
    expect(manager.delete).not.toHaveBeenCalled();
    expect(resourceService.invalidateSubjectMapCache).not.toHaveBeenCalled();
  });

  it('reads the holders of a deleted role before it deletes their membership rows', async () => {
    await run({ tables: ['roles'], roleIds: ['r-1'], deletedRoleIds: ['r-1'] });

    expect(manager.delete).toHaveBeenCalledWith(UserRole, {
      roleId: In(['r-1'])
    });
    const [read] = permissionService.findHolderIds.mock.invocationCallOrder;
    const [remove] = manager.delete.mock.invocationCallOrder;

    expect(read).toBeLessThan(remove);
    expect(permissionService.invalidateUserCache).toHaveBeenCalledTimes(2);
  });

  it('in the process scope drops the lists of the holders of a deleted role and keeps their rows for the other processes', async () => {
    await run(
      { tables: ['roles'], roleIds: ['r-1'], deletedRoleIds: ['r-1'] },
      'process'
    );
    await run({ all: true }, 'process');

    expect(permissionService.invalidateUserCache).toHaveBeenCalledTimes(2);
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
    expect(settings.query).not.toHaveBeenCalled();
  });

  it('pushes nothing when a changed role has no holder', async () => {
    permissionService.findHolderIds.mockResolvedValue([]);

    await run({ tables: ['roles'], roleIds: ['r-1'] });

    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it.each(['resources', 'permissions', 'actions'] as const)(
    'drops the subject map on a change of %s',
    async (table) => {
      permissionService.findHolderIds.mockResolvedValue([]);

      await run({ tables: [table] });

      expect(resourceService.invalidateSubjectMapCache).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it('on a rebase drops every list and the subject map, and deletes the membership rows of missing roles', async () => {
    manager.query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.startsWith('SELECT') ? [{ id: 'r-live' }, { id: 'r-gone' }] : []
      )
    );
    settings.query.mockResolvedValue([{ id: 'r-live' }]);

    await run({ all: true });

    expect(permissionService.invalidateAll).toHaveBeenCalledTimes(1);
    expect(resourceService.invalidateSubjectMapCache).toHaveBeenCalledTimes(1);
    expect(settings.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM "roles"'),
      [['r-live', 'r-gone']]
    );
    expect(manager.query).toHaveBeenLastCalledWith(
      expect.stringContaining('DELETE FROM "user_roles"'),
      [['r-gone']]
    );
    expect(permissionService.findHolderIds).not.toHaveBeenCalled();
  });

  it('lets a failed cache drop fail the apply', async () => {
    permissionService.invalidateUserCache.mockRejectedValue(
      new Error('redis down')
    );

    await expect(run({ tables: ['roles'], roleIds: ['r-1'] })).rejects.toThrow(
      'redis down'
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
