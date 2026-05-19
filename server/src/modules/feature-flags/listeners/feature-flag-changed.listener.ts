import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { UserRoleChangedEvent } from '../../auth/events/user-role-changed.event';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';

@Injectable()
export class FeatureFlagChangedListener {
  constructor(
    private readonly resolver: FeatureFlagResolverService,
    private readonly notificationsService: NotificationsService
  ) {}

  @OnEvent(FeatureFlagChangedEvent.name)
  async handleFeatureFlagChanged(
    _event: FeatureFlagChangedEvent
  ): Promise<void> {
    await this.resolver.invalidateAll();
    this.notificationsService.pushToAll({ type: 'feature_flags_updated' });
  }

  @OnEvent(UserRoleChangedEvent.name)
  async handleUserRoleChanged(event: UserRoleChangedEvent): Promise<void> {
    await this.resolver.invalidateUser(event.userId);
    this.notificationsService.push(event.userId, {
      type: 'feature_flags_updated'
    });
  }

  @OnEvent(UserDeletedEvent.name)
  async handleUserDeleted(event: UserDeletedEvent): Promise<void> {
    await this.resolver.invalidateUser(event.userId);
  }
}
