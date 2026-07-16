import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { UserRoleChangedEvent } from '../../auth/events/user-role-changed.event';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';

export const FLAGS_BROADCAST_COALESCE_MS = 500;

@Injectable()
export class FeatureFlagChangedListener implements OnModuleDestroy {
  #broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly resolver: FeatureFlagResolverService,
    private readonly notificationsService: NotificationsService
  ) {}

  @OnEvent(FeatureFlagChangedEvent.name)
  async handleFeatureFlagChanged(
    _event: FeatureFlagChangedEvent
  ): Promise<void> {
    await this.resolver.invalidateAll();
    // Every broadcast makes all connected clients refetch their flag set at
    // once, so a burst of changes (e.g. one dialog save emitting update +
    // rules-replaced) must collapse into a single delayed push, not N.
    if (this.#broadcastTimer) return;
    this.#broadcastTimer = setTimeout(() => {
      this.#broadcastTimer = null;
      this.notificationsService.pushToAll({ type: 'feature_flags_updated' });
    }, FLAGS_BROADCAST_COALESCE_MS);
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

  onModuleDestroy(): void {
    if (this.#broadcastTimer) {
      clearTimeout(this.#broadcastTimer);
      this.#broadcastTimer = null;
    }
  }
}
