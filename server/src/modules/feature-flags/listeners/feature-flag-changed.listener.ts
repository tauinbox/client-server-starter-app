import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SettingsChangedEvent } from '../../core/settings-change-log/settings-changed.event';
import { touches } from '../../core/settings-change-log/settings-change.types';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { deleteOrphanRuleMembers } from '../utils/rule-members';

export const FLAGS_BROADCAST_COALESCE_MS = 500;

/** Applies a change of the flags or their rules from the settings change log. */
@Injectable()
export class FeatureFlagChangedListener implements OnModuleDestroy {
  #broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly resolver: FeatureFlagResolverService,
    private readonly notificationsService: NotificationsService
  ) {}

  @OnEvent(SettingsChangedEvent.name, { suppressErrors: false })
  async handleSettingsChanged({
    change,
    manager
  }: SettingsChangedEvent): Promise<void> {
    if (!touches(change, 'feature_flags', 'feature_flag_rules')) return;

    // In every scope: no apply reads these rows, so an early delete hides
    // nothing from another process.
    await deleteOrphanRuleMembers(manager);
    await this.resolver.invalidateAll();

    // Every broadcast makes all connected clients refetch their flag set at
    // once, so a burst of changes (e.g. several saves in quick succession)
    // must collapse into a single delayed push, not N.
    if (this.#broadcastTimer) return;

    this.#broadcastTimer = setTimeout(() => {
      this.#broadcastTimer = null;
      this.notificationsService.pushToAll({ type: 'feature_flags_updated' });
    }, FLAGS_BROADCAST_COALESCE_MS);
  }

  onModuleDestroy(): void {
    if (this.#broadcastTimer) {
      clearTimeout(this.#broadcastTimer);
      this.#broadcastTimer = null;
    }
  }
}
