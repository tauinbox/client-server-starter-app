import {
  Injectable,
  Logger,
  type OnApplicationBootstrap
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntitlementService } from '../entitlements/entitlement.service';
import { ENTITLEMENT_CHANGING_EVENTS } from '../events/billing.events';

/**
 * Invalidates a user's cached entitlements whenever a billing event changes what
 * their plan grants. Every entitlement-affecting event carries `userId`, so a
 * single handler keyed on the shared event list covers them all.
 *
 * Listeners are bound explicitly on bootstrap rather than via `@OnEvent`:
 * EventEmitter2's `on` does not accept an array of event names (it would register
 * a single never-matched listener), so the shared handler is attached to each
 * event name in turn.
 */
@Injectable()
export class EntitlementCacheListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(EntitlementCacheListener.name);

  constructor(
    private readonly entitlements: EntitlementService,
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
    await this.entitlements.invalidateUser(event.userId);
  }
}
