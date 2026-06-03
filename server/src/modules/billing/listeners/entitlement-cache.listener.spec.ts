import { EntitlementService } from '../entitlements/entitlement.service';
import { EntitlementCacheListener } from './entitlement-cache.listener';
import {
  InvoicePaidEvent,
  SubscriptionActivatedEvent
} from '../events/billing.events';

describe('EntitlementCacheListener', () => {
  let listener: EntitlementCacheListener;
  let entitlements: { invalidateUser: jest.Mock };

  beforeEach(() => {
    entitlements = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    listener = new EntitlementCacheListener(
      entitlements as unknown as EntitlementService
    );
  });

  it('invalidates the affected user on a subscription event', async () => {
    await listener.handleBillingChange(
      new SubscriptionActivatedEvent('user-1', 'sub-1')
    );
    expect(entitlements.invalidateUser).toHaveBeenCalledWith('user-1');
  });

  it('invalidates the affected user on an invoice event', async () => {
    await listener.handleBillingChange(new InvoicePaidEvent('user-2', 'inv-1'));
    expect(entitlements.invalidateUser).toHaveBeenCalledWith('user-2');
  });
});
