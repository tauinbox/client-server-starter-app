import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import { UserDeletedEvent } from '../users/events/user-deleted.event';
import { UserPasswordChangedByAdminEvent } from '../users/events/user-password-changed-by-admin.event';
import { UserCreatedEvent } from '../users/events/user-created.event';
import { UserUpdatedEvent } from '../users/events/user-updated.event';
import { UserRestoredEvent } from '../users/events/user-restored.event';
import { UserRoleChangedEvent } from '../auth/events/user-role-changed.event';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let service: { push: jest.Mock; pushToAll: jest.Mock };

  beforeEach(async () => {
    service = {
      push: jest.fn(),
      pushToAll: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsListener,
        { provide: NotificationsService, useValue: service }
      ]
    }).compile();

    listener = module.get<NotificationsListener>(NotificationsListener);
  });

  it('should push session_invalidated and user_crud_events deleted on UserDeletedEvent', () => {
    listener.handleUserDeleted(new UserDeletedEvent('user-1'));

    expect(service.push).toHaveBeenCalledWith('user-1', {
      type: 'session_invalidated',
      userId: 'user-1'
    });
    expect(service.pushToAll).toHaveBeenCalledWith({
      type: 'user_crud_events',
      action: 'deleted',
      userId: 'user-1'
    });
  });

  it('should push session_invalidated on UserPasswordChangedByAdminEvent', () => {
    listener.handlePasswordChangedByAdmin(
      new UserPasswordChangedByAdminEvent('user-2')
    );

    expect(service.push).toHaveBeenCalledWith('user-2', {
      type: 'session_invalidated',
      userId: 'user-2'
    });
    expect(service.pushToAll).not.toHaveBeenCalled();
  });

  it('should pushToAll user_crud_events created on UserCreatedEvent', () => {
    listener.handleUserCreated(new UserCreatedEvent('user-3'));

    expect(service.pushToAll).toHaveBeenCalledWith({
      type: 'user_crud_events',
      action: 'created',
      userId: 'user-3'
    });
  });

  it('should pushToAll user_crud_events updated on UserUpdatedEvent', () => {
    listener.handleUserUpdated(new UserUpdatedEvent('user-4'));

    expect(service.pushToAll).toHaveBeenCalledWith({
      type: 'user_crud_events',
      action: 'updated',
      userId: 'user-4'
    });
  });

  it('should pushToAll user_crud_events restored on UserRestoredEvent', () => {
    listener.handleUserRestored(new UserRestoredEvent('user-5'));

    expect(service.pushToAll).toHaveBeenCalledWith({
      type: 'user_crud_events',
      action: 'restored',
      userId: 'user-5'
    });
  });

  it('should push permissions_updated on UserRoleChangedEvent', () => {
    listener.handleUserRoleChanged(new UserRoleChangedEvent('user-6'));

    expect(service.push).toHaveBeenCalledWith('user-6', {
      type: 'permissions_updated',
      userId: 'user-6'
    });
  });
});
