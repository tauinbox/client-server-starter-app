import {
  Injectable,
  Logger,
  type OnApplicationBootstrap
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from '../../notifications/notifications.service';
import { EntitlementService } from '../../entitlements/entitlement.service';
import { ENTITLEMENT_CHANGING_EVENTS } from '../events/billing.events';

/**
 * Reacts to every billing event that changes what a user's plan grants:
 * invalidates their cached entitlements, then tells the connected client so its
 * advisory mirror does not sit stale for the cache TTL plus the time to the
 * next navigation. Every entitlement-affecting event carries `userId`, so a
 * single handler keyed on the shared event list covers them all.
 *
 * Listeners are bound explicitly on bootstrap rather than via `@OnEvent`:
 * EventEmitter2's `on` does not accept an array of event names (it would register
 * a single never-matched listener), so the shared handler is attached to each
 * event name in turn.
 */
@Injectable()
export class EntitlementChangedListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(EntitlementChangedListener.name);

  constructor(
    private readonly entitlements: EntitlementService,
    private readonly notifications: NotificationsService,
    private readonly emitter: EventEmitter2
  ) {}

  onApplicationBootstrap(): void {
    for (const event of ENTITLEMENT_CHANGING_EVENTS) {
      this.emitter.on(event, (payload: { userId: string }) => {
        void this.handleBillingChange(payload).catch((error) => {
          this.logger.error(
            `Failed to invalidate entitlements for user ${payload.userId}`,
            error as Error
          );
        });
      });
    }
  }

  async handleBillingChange(event: { userId: string }): Promise<void> {
    // Invalidate before notifying: the push makes the client re-read, and a
    // read issued against a still-cached value would re-cache the stale set.
    await this.entitlements.invalidateUser(event.userId);
    this.notifications.push(event.userId, {
      type: 'entitlements_updated',
      userId: event.userId
    });
  }
}
