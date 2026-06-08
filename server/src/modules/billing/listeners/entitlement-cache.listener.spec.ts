import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntitlementService } from '../entitlements/entitlement.service';
import { EntitlementCacheListener } from './entitlement-cache.listener';
import {
  ENTITLEMENT_CHANGING_EVENTS,
  InvoicePaidEvent,
  SubscriptionActivatedEvent,
  SubscriptionCanceledEvent
} from '../events/billing.events';

async function build(): Promise<{
  listener: EntitlementCacheListener;
  emitter: EventEmitter2;
  invalidateUser: jest.Mock;
}> {
  const invalidateUser = jest.fn().mockResolvedValue(undefined);
  const moduleRef = await Test.createTestingModule({
    providers: [
      EntitlementCacheListener,
      { provide: EntitlementService, useValue: { invalidateUser } },
      { provide: EventEmitter2, useValue: new EventEmitter2() }
    ]
  }).compile();
  return {
    listener: moduleRef.get(EntitlementCacheListener),
    emitter: moduleRef.get(EventEmitter2),
    invalidateUser
  };
}

describe('EntitlementCacheListener', () => {
  it('invalidates the affected user on a subscription event', async () => {
    const { listener, invalidateUser } = await build();
    await listener.handleBillingChange(
      new SubscriptionActivatedEvent('user-1', 'sub-1')
    );
    expect(invalidateUser).toHaveBeenCalledWith('user-1');
  });

  it('invalidates the affected user on an invoice event', async () => {
    const { listener, invalidateUser } = await build();
    await listener.handleBillingChange(new InvoicePaidEvent('user-2', 'inv-1'));
    expect(invalidateUser).toHaveBeenCalledWith('user-2');
  });

  it('binds to every entitlement-changing event name on bootstrap', async () => {
    const { listener, emitter, invalidateUser } = await build();
    listener.onApplicationBootstrap();

    emitter.emit(
      SubscriptionCanceledEvent.name,
      new SubscriptionCanceledEvent('user-3', 'sub-3')
    );
    // The handler runs synchronously up to its first await, so the invalidation
    // call is registered by the time emit returns.
    await Promise.resolve();

    expect(invalidateUser).toHaveBeenCalledWith('user-3');
  });

  it('covers the full shared event list', () => {
    expect(ENTITLEMENT_CHANGING_EVENTS).toContain(
      SubscriptionCanceledEvent.name
    );
    expect(ENTITLEMENT_CHANGING_EVENTS).toContain(InvoicePaidEvent.name);
  });
});
