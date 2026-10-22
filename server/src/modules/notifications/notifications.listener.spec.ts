import { Test, TestingModule } from '@nestjs/testing';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import { UserDeletedEvent } from '../users/events/user-deleted.event';
import { UserCreatedEvent } from '../users/events/user-created.event';
import { UserUpdatedEvent } from '../users/events/user-updated.event';
import { UserRestoredEvent } from '../users/events/user-restored.event';
import { RolePermissionsChangedEvent } from '../auth/events/role-permissions-changed.event';
import { RoleRenamedEvent } from '../auth/events/role-renamed.event';
import { RoleDeletedEvent } from '../auth/events/role-deleted.event';
import type { EntityManager } from 'typeorm';
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

  it('should broadcast permissions_updated in one call on ResourceActionsChangedEvent', () => {
    listener.handleResourceActionsChanged();

    expect(service.pushToAll.mock.calls).toEqual([
      [{ type: 'permissions_updated' }]
    ]);
  });

  describe('user_list_stale', () => {
    // The listener does not read the manager of a role event.
    const em = {} as EntityManager;
    let commit: () => void;
    let committed: Promise<void>;

    beforeEach(() => {
      committed = new Promise<void>((resolve) => {
        commit = resolve;
      });
    });

    async function expectPushAfterCommit(handle: () => void): Promise<void> {
      handle();
      await Promise.resolve();
      expect(service.pushToAuthorized).not.toHaveBeenCalled();

      commit();
      await committed;
      await Promise.resolve();

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
    }

    it('should push to user-list viewers after the commit of a role rename', () =>
      expectPushAfterCommit(() =>
        listener.handleRoleRenamed(
          new RoleRenamedEvent('a', 'b', em, committed)
        )
      ));

    it('should push to user-list viewers after the commit of a role delete', () =>
      expectPushAfterCommit(() =>
        listener.handleRoleDeleted(new RoleDeletedEvent('a', em, committed))
      ));
  });
});
