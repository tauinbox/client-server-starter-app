import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import { UserDeletedEvent } from '../users/events/user-deleted.event';
import { UserPasswordChangedByAdminEvent } from '../users/events/user-password-changed-by-admin.event';
import { UserCreatedEvent } from '../users/events/user-created.event';
import { UserUpdatedEvent } from '../users/events/user-updated.event';
import { UserRestoredEvent } from '../users/events/user-restored.event';
import { UserRoleChangedEvent } from '../auth/events/user-role-changed.event';
import { RolePermissionsChangedEvent } from '../auth/events/role-permissions-changed.event';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let service: {
    push: jest.Mock;
    pushToAll: jest.Mock;
    pushToAuthorized: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      push: jest.fn(),
      pushToAll: jest.fn(),
      pushToAuthorized: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsListener,
        { provide: NotificationsService, useValue: service }
      ]
    }).compile();

    listener = module.get<NotificationsListener>(NotificationsListener);
  });

  it('should push session_invalidated and user_crud_events deleted on UserDeletedEvent', async () => {
    await listener.handleUserDeleted(new UserDeletedEvent('user-1'));

    expect(service.push).toHaveBeenCalledWith('user-1', {
      type: 'session_invalidated',
      userId: 'user-1'
    });
    expect(service.pushToAuthorized).toHaveBeenCalledWith(
      { type: 'user_crud_events', action: 'deleted', userId: 'user-1' },
      ['search', 'User']
    );
  });

  it('should never broadcast user_crud_events to every connected client', async () => {
    await listener.handleUserCreated(new UserCreatedEvent('user-x'));
    await listener.handleUserUpdated(new UserUpdatedEvent('user-x'));
    await listener.handleUserDeleted(new UserDeletedEvent('user-x'));
    await listener.handleUserRestored(new UserRestoredEvent('user-x'));

    expect(service.pushToAll).not.toHaveBeenCalled();
  });

  it('should push session_invalidated on UserPasswordChangedByAdminEvent', () => {
    listener.handlePasswordChangedByAdmin(
      new UserPasswordChangedByAdminEvent('user-2')
    );

    expect(service.push).toHaveBeenCalledWith('user-2', {
      type: 'session_invalidated',
      userId: 'user-2'
    });
    expect(service.pushToAuthorized).not.toHaveBeenCalled();
  });

  it('should push user_crud_events created to user-list viewers on UserCreatedEvent', async () => {
    await listener.handleUserCreated(new UserCreatedEvent('user-3'));

    expect(service.pushToAuthorized).toHaveBeenCalledWith(
      { type: 'user_crud_events', action: 'created', userId: 'user-3' },
      ['search', 'User']
    );
  });

  it('should push user_crud_events updated to user-list viewers on UserUpdatedEvent', async () => {
    await listener.handleUserUpdated(new UserUpdatedEvent('user-4'));

    expect(service.pushToAuthorized).toHaveBeenCalledWith(
      { type: 'user_crud_events', action: 'updated', userId: 'user-4' },
      ['search', 'User']
    );
  });

  it('should push user_crud_events restored to user-list viewers on UserRestoredEvent', async () => {
    await listener.handleUserRestored(new UserRestoredEvent('user-5'));

    expect(service.pushToAuthorized).toHaveBeenCalledWith(
      { type: 'user_crud_events', action: 'restored', userId: 'user-5' },
      ['search', 'User']
    );
  });

  it('should push permissions_updated on UserRoleChangedEvent', () => {
    listener.handleUserRoleChanged(new UserRoleChangedEvent('user-6'));

    expect(service.push).toHaveBeenCalledWith('user-6', {
      type: 'permissions_updated',
      userId: 'user-6'
    });
  });

  it('should push permissions_updated to every holder on RolePermissionsChangedEvent', () => {
    listener.handleRolePermissionsChanged(
      new RolePermissionsChangedEvent(['user-7', 'user-8'])
    );

    expect(service.push).toHaveBeenCalledWith('user-7', {
      type: 'permissions_updated',
      userId: 'user-7'
    });
    expect(service.push).toHaveBeenCalledWith('user-8', {
      type: 'permissions_updated',
      userId: 'user-8'
    });
    expect(service.push).toHaveBeenCalledTimes(2);
  });

  it('should push nothing when no holders on RolePermissionsChangedEvent', () => {
    listener.handleRolePermissionsChanged(new RolePermissionsChangedEvent([]));

    expect(service.push).not.toHaveBeenCalled();
  });
});
