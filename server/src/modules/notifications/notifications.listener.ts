import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { UserDeletedEvent } from '../users/events/user-deleted.event';
import { UserPasswordChangedByAdminEvent } from '../users/events/user-password-changed-by-admin.event';
import { UserCreatedEvent } from '../users/events/user-created.event';
import { UserUpdatedEvent } from '../users/events/user-updated.event';
import { UserRestoredEvent } from '../users/events/user-restored.event';
import { UserRoleChangedEvent } from '../auth/events/user-role-changed.event';
import { RolePermissionsChangedEvent } from '../auth/events/role-permissions-changed.event';
import type { PermissionCheck } from '../auth/casl/app-ability';
import type { NotificationEvent } from '@app/shared/types';

type UserCrudAction = Extract<
  NotificationEvent,
  { type: 'user_crud_events' }
>['action'];

// user_crud_events only drive the admin user list, so they are limited to
// clients that may list users - a broadcast would leak user IDs and the fact
// that an account was created/updated/deleted to every authenticated client.
const USER_LIST_ACCESS: PermissionCheck = ['search', 'User'];

@Injectable()
export class NotificationsListener {
  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(UserDeletedEvent.name)
  async handleUserDeleted(event: UserDeletedEvent): Promise<void> {
    this.notificationsService.push(event.userId, {
      type: 'session_invalidated',
      userId: event.userId
    });
    await this.#pushUserCrudEvent('deleted', event.userId);
  }

  @OnEvent(UserPasswordChangedByAdminEvent.name)
  handlePasswordChangedByAdmin(event: UserPasswordChangedByAdminEvent): void {
    this.notificationsService.push(event.userId, {
      type: 'session_invalidated',
      userId: event.userId
    });
  }

  @OnEvent(UserCreatedEvent.name)
  async handleUserCreated(event: UserCreatedEvent): Promise<void> {
    await this.#pushUserCrudEvent('created', event.userId);
  }

  @OnEvent(UserUpdatedEvent.name)
  async handleUserUpdated(event: UserUpdatedEvent): Promise<void> {
    await this.#pushUserCrudEvent('updated', event.userId);
  }

  @OnEvent(UserRestoredEvent.name)
  async handleUserRestored(event: UserRestoredEvent): Promise<void> {
    await this.#pushUserCrudEvent('restored', event.userId);
  }

  @OnEvent(UserRoleChangedEvent.name)
  handleUserRoleChanged(event: UserRoleChangedEvent): void {
    this.notificationsService.push(event.userId, {
      type: 'permissions_updated',
      userId: event.userId
    });
  }

  @OnEvent(RolePermissionsChangedEvent.name)
  handleRolePermissionsChanged(event: RolePermissionsChangedEvent): void {
    for (const userId of event.userIds) {
      this.notificationsService.push(userId, {
        type: 'permissions_updated',
        userId
      });
    }
  }

  #pushUserCrudEvent(action: UserCrudAction, userId: string): Promise<void> {
    return this.notificationsService.pushToAuthorized(
      { type: 'user_crud_events', action, userId },
      USER_LIST_ACCESS
    );
  }
}
