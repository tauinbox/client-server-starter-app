import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { UserDeletedEvent } from '../users/events/user-deleted.event';
import { UserPasswordChangedByAdminEvent } from '../users/events/user-password-changed-by-admin.event';
import { UserCreatedEvent } from '../users/events/user-created.event';
import { UserUpdatedEvent } from '../users/events/user-updated.event';
import { UserRestoredEvent } from '../users/events/user-restored.event';
import { UserRoleChangedEvent } from '../auth/events/user-role-changed.event';

@Injectable()
export class NotificationsListener {
  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(UserDeletedEvent.name)
  handleUserDeleted(event: UserDeletedEvent): void {
    this.notificationsService.push(event.userId, {
      type: 'session_invalidated',
      userId: event.userId
    });
    this.notificationsService.pushToAll({
      type: 'user_crud_events',
      action: 'deleted',
      userId: event.userId
    });
  }

  @OnEvent(UserPasswordChangedByAdminEvent.name)
  handlePasswordChangedByAdmin(event: UserPasswordChangedByAdminEvent): void {
    this.notificationsService.push(event.userId, {
      type: 'session_invalidated',
      userId: event.userId
    });
  }

  @OnEvent(UserCreatedEvent.name)
  handleUserCreated(event: UserCreatedEvent): void {
    this.notificationsService.pushToAll({
      type: 'user_crud_events',
      action: 'created',
      userId: event.userId
    });
  }

  @OnEvent(UserUpdatedEvent.name)
  handleUserUpdated(event: UserUpdatedEvent): void {
    this.notificationsService.pushToAll({
      type: 'user_crud_events',
      action: 'updated',
      userId: event.userId
    });
  }

  @OnEvent(UserRestoredEvent.name)
  handleUserRestored(event: UserRestoredEvent): void {
    this.notificationsService.pushToAll({
      type: 'user_crud_events',
      action: 'restored',
      userId: event.userId
    });
  }

  @OnEvent(UserRoleChangedEvent.name)
  handleUserRoleChanged(event: UserRoleChangedEvent): void {
    this.notificationsService.push(event.userId, {
      type: 'permissions_updated',
      userId: event.userId
    });
  }
}
