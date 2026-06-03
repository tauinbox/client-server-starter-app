import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EntitlementService } from '../entitlements/entitlement.service';
import { ENTITLEMENT_CHANGING_EVENTS } from '../events/billing.events';

/**
 * Invalidates a user's cached entitlements whenever a billing event changes what
 * their plan grants. Every entitlement-affecting event carries `userId`, so a
 * single handler keyed on the shared event list covers them all.
 */
@Injectable()
export class EntitlementCacheListener {
  constructor(private readonly entitlements: EntitlementService) {}

  @OnEvent(ENTITLEMENT_CHANGING_EVENTS)
  async handleBillingChange(event: { userId: string }): Promise<void> {
    await this.entitlements.invalidateUser(event.userId);
  }
}
