import { Test, TestingModule } from '@nestjs/testing';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import { UserDeletedEvent } from '../users/events/user-deleted.event';
import { UserCreatedEvent } from '../users/events/user-created.event';
import { UserUpdatedEvent } from '../users/events/user-updated.event';
import { UserRestoredEvent } from '../users/events/user-restored.event';
import { RolePermissionsChangedEvent } from '../auth/events/role-permissions-changed.event';
import { settingsChangedEvent } from '../core/settings-change-log/testing/settings-changed-event';
import { UsersService } from '../users/services/users.service';
import type { AppAbility } from '../auth/casl/app-ability';

function abilityOf(define: (can: AbilityBuilder<AppAbility>['can']) => void) {
  const builder = new AbilityBuilder<AppAbility>(createMongoAbility);

  define(builder.can);

  return builder.build();
}

const searchUser = { action: 'search', subject: 'User' };

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let service: {
    push: jest.Mock;
    pushToAll: jest.Mock;
    pushToAuthorized: jest.Mock;
    pushToUsers: jest.Mock;
  };
  let usersService: { findByIdWithDeleted: jest.Mock };

  beforeEach(async () => {
    service = {
      push: jest.fn(),
      pushToAll: jest.fn(),
      pushToAuthorized: jest.fn().mockResolvedValue(undefined),
      pushToUsers: jest.fn().mockResolvedValue(undefined)
    };
    usersService = {
      findByIdWithDeleted: jest
        .fn()
        .mockImplementation((id: string) => Promise.resolve({ id }))
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsListener,
        { provide: NotificationsService, useValue: service },
        { provide: UsersService, useValue: usersService }
      ]
    }).compile();

    listener = module.get<NotificationsListener>(NotificationsListener);
  });

  it('should push user_crud_events deleted, and nothing to the deleted user, on UserDeletedEvent', async () => {
    await listener.handleUserDeleted(new UserDeletedEvent('user-1'));

    expect(service.push).not.toHaveBeenCalled();
    expect(service.pushToAuthorized).toHaveBeenCalledWith(
      { type: 'user_crud_events', action: 'deleted', userId: 'user-1' },
      expect.any(Function),
      searchUser
    );
  });

  it('should never broadcast user_crud_events to every connected client', async () => {
    await listener.handleUserCreated(new UserCreatedEvent('user-x'));
    await listener.handleUserUpdated(new UserUpdatedEvent('user-x'));
    await listener.handleUserDeleted(new UserDeletedEvent('user-x'));
    await listener.handleUserRestored(new UserRestoredEvent('user-x'));

    expect(service.pushToAll).not.toHaveBeenCalled();
  });

  it('should check the search grant on the user record, not on the type', async () => {
    await listener.handleUserUpdated(new UserUpdatedEvent('other-user'));
    await listener.handleUserUpdated(new UserUpdatedEvent('viewer'));

    const [[, allowsOther], [, allowsOwn]] = service.pushToAuthorized.mock
      .calls as [unknown, (ability: AppAbility) => boolean][];
    const scoped = abilityOf((can) => can('search', 'User', { id: 'viewer' }));
    const unconditional = abilityOf((can) => can('search', 'User'));
    const none = abilityOf(() => undefined);

    expect(scoped.can('search', 'User')).toBe(true);
    expect(allowsOther(scoped)).toBe(false);
    expect(allowsOwn(scoped)).toBe(true);
    expect(allowsOther(unconditional)).toBe(true);
    expect(allowsOther(none)).toBe(false);
  });

  it('should send an update to a viewer that saw the record before the change', async () => {
    usersService.findByIdWithDeleted.mockResolvedValue({
      id: 'user-11',
      isActive: false
    });

    await listener.handleUserUpdated(
      // @ts-expect-error partial record: the condition reads only isActive
      new UserUpdatedEvent('user-11', { id: 'user-11', isActive: true })
    );

    const [[, allows]] = service.pushToAuthorized.mock.calls as [
      unknown,
      (ability: AppAbility) => boolean
    ][];

    expect(
      allows(abilityOf((can) => can('search', 'User', { isActive: true })))
    ).toBe(true);
    expect(
      allows(abilityOf((can) => can('search', 'User', { email: 'x' })))
    ).toBe(false);
  });

  it('should read the user with soft-deleted rows, so a deleted event still has its record', async () => {
    await listener.handleUserDeleted(new UserDeletedEvent('user-9'));

    expect(usersService.findByIdWithDeleted).toHaveBeenCalledWith('user-9');
    expect(service.pushToAuthorized).toHaveBeenCalledTimes(1);
  });

  it('should push no user_crud_events when the user row is gone', async () => {
    usersService.findByIdWithDeleted.mockResolvedValue(null);

    await listener.handleUserDeleted(new UserDeletedEvent('user-10'));

    expect(service.pushToAuthorized).not.toHaveBeenCalled();
  });

  it('should push user_crud_events created to user-list viewers on UserCreatedEvent', async () => {
    await listener.handleUserCreated(new UserCreatedEvent('user-3'));

    expect(service.pushToAuthorized).toHaveBeenCalledWith(
      { type: 'user_crud_events', action: 'created', userId: 'user-3' },
      expect.any(Function),
      searchUser
    );
  });

  it('should push user_crud_events updated to user-list viewers on UserUpdatedEvent', async () => {
    await listener.handleUserUpdated(new UserUpdatedEvent('user-4'));

    expect(service.pushToAuthorized).toHaveBeenCalledWith(
      { type: 'user_crud_events', action: 'updated', userId: 'user-4' },
      expect.any(Function),
      searchUser
    );
  });

  it('should push user_crud_events restored to user-list viewers on UserRestoredEvent', async () => {
    await listener.handleUserRestored(new UserRestoredEvent('user-5'));

    expect(service.pushToAuthorized).toHaveBeenCalledWith(
      { type: 'user_crud_events', action: 'restored', userId: 'user-5' },
      expect.any(Function),
      searchUser
    );
  });

  it('should push permissions_updated to the holders in one call on RolePermissionsChangedEvent', async () => {
    await listener.handleRolePermissionsChanged(
      new RolePermissionsChangedEvent(['user-7', 'user-8'])
    );

    expect(service.pushToUsers.mock.calls).toEqual([
      [['user-7', 'user-8'], { type: 'permissions_updated' }]
    ]);
    expect(service.push).not.toHaveBeenCalled();
  });

  it.each([
    ['resources', { tables: ['resources' as const] }],
    ['permissions', { tables: ['permissions' as const] }],
    ['actions', { tables: ['actions' as const] }],
    ['a rebase', { all: true }]
  ])(
    'should broadcast permissions_updated in one call on a change of %s',
    (_case, change) => {
      listener.handleSettingsChanged(settingsChangedEvent(change));

      expect(service.pushToAll.mock.calls).toEqual([
        [{ type: 'permissions_updated' }]
      ]);
    }
  );

  it('should push nothing for a change of flags or plans', () => {
    listener.handleSettingsChanged(
      settingsChangedEvent({ tables: ['feature_flags', 'plans'] })
    );

    expect(service.pushToAll).not.toHaveBeenCalled();
    expect(service.pushToAuthorized).not.toHaveBeenCalled();
  });

  describe('user_list_stale', () => {
    it.each([
      ['a role change', { tables: ['roles' as const] }],
      ['a rebase', { all: true }]
    ])('should push to user-list viewers on %s', (_case, change) => {
      listener.handleSettingsChanged(settingsChangedEvent(change));

      expect(service.pushToAuthorized).toHaveBeenCalledWith(
        { type: 'user_list_stale' },
        expect.any(Function),
        searchUser
      );
      const [[, allows]] = service.pushToAuthorized.mock.calls as [
        unknown,
        (ability: AppAbility) => boolean
      ][];

      expect(allows(abilityOf((can) => can('search', 'User')))).toBe(true);
      expect(allows(abilityOf((can) => can('read', 'Role')))).toBe(false);
    });

    it('should not fail the apply when the push fails', async () => {
      service.pushToAuthorized.mockRejectedValue(new Error('redis down'));

      expect(() =>
        listener.handleSettingsChanged(
          settingsChangedEvent({ tables: ['roles'] })
        )
      ).not.toThrow();
      await Promise.resolve();
    });
  });
});
