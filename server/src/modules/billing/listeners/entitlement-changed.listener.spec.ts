import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from '../../notifications/notifications.service';
import { EntitlementService } from '../../entitlements/entitlement.service';
import { EntitlementChangedListener } from './entitlement-changed.listener';
import {
  ENTITLEMENT_CHANGING_EVENTS,
  InvoicePaidEvent,
  SubscriptionActivatedEvent,
  SubscriptionCanceledEvent
} from '../events/billing.events';

async function build(): Promise<{
  listener: EntitlementChangedListener;
  emitter: EventEmitter2;
  invalidateUser: jest.Mock;
  push: jest.Mock;
}> {
  const invalidateUser = jest.fn().mockResolvedValue(undefined);
  const push = jest.fn();
  const moduleRef = await Test.createTestingModule({
    providers: [
      EntitlementChangedListener,
      { provide: EntitlementService, useValue: { invalidateUser } },
      { provide: NotificationsService, useValue: { push } },
      { provide: EventEmitter2, useValue: new EventEmitter2() }
    ]
  }).compile();
  return {
    listener: moduleRef.get(EntitlementChangedListener),
    emitter: moduleRef.get(EventEmitter2),
    invalidateUser,
    push
  };
}

describe('EntitlementChangedListener', () => {
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

  it('pushes entitlements_updated to the affected user only', async () => {
    const { listener, push } = await build();
    await listener.handleBillingChange(new InvoicePaidEvent('user-2', 'inv-1'));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('user-2', {
      type: 'entitlements_updated',
      userId: 'user-2'
    });
  });

  it('invalidates before notifying, so the client cannot re-cache a stale set', async () => {
    const { listener, invalidateUser, push } = await build();
    const order: string[] = [];
    invalidateUser.mockImplementation(() => {
      order.push('invalidate');
      return Promise.resolve();
    });
    push.mockImplementation(() => {
      order.push('push');
    });

    await listener.handleBillingChange(new InvoicePaidEvent('user-4', 'inv-4'));

    expect(order).toEqual(['invalidate', 'push']);
  });

  it('does not notify when invalidation fails', async () => {
    const { listener, invalidateUser, push } = await build();
    invalidateUser.mockRejectedValue(new Error('cache down'));

    await expect(
      listener.handleBillingChange(new InvoicePaidEvent('user-5', 'inv-5'))
    ).rejects.toThrow('cache down');
    expect(push).not.toHaveBeenCalled();
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
