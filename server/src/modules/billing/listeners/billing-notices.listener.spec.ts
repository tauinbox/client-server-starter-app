import { Money } from '@app/shared/utils/money';
import type { Invoice } from '../entities/invoice.entity';
import type { Subscription } from '../entities/subscription.entity';
import {
  CreditBalanceCrossedEvent,
  InvoicePaidEvent,
  PaymentFailedEvent,
  RefundIssuedEvent,
  RenewalUpcomingEvent,
  SubscriptionCancelScheduledEvent,
  SubscriptionCanceledEvent
} from '../events/billing.events';
import { BillingNoticesListener } from './billing-notices.listener';

const PERIOD_END = new Date('2026-12-01T00:00:00.000Z');

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  // @ts-expect-error the listener reads these fields only
  return {
    id: 'sub-1',
    planKey: 'pro',
    status: 'active',
    cancelAtPeriodEnd: false,
    trialEnd: null,
    currentPeriodEnd: PERIOD_END,
    nextRenewalAttemptAt: null,
    ...overrides
  };
}

function build({
  invoice = null,
  sub = null
}: { invoice?: Partial<Invoice> | null; sub?: Subscription | null } = {}) {
  const notify = jest.fn().mockResolvedValue(undefined);
  const listener = new BillingNoticesListener(
    // @ts-expect-error only `notify` is used
    { notify },
    { findOne: jest.fn().mockResolvedValue(invoice) },
    { findOne: jest.fn().mockResolvedValue(sub) },
    { findOne: jest.fn().mockResolvedValue({ name: 'Pro' }) }
  );

  return { listener, notify };
}

describe('BillingNoticesListener', () => {
  it('stores a paid notice with the amount of the invoice', async () => {
    const { listener, notify } = build({
      invoice: { amountMinor: Money.fromMinor(99000), currency: 'RUB' }
    });

    await listener.onInvoicePaid(new InvoicePaidEvent('user-1', 'inv-1'));

    expect(notify).toHaveBeenCalledWith('user-1', {
      kind: 'invoice_paid',
      payload: { invoiceId: 'inv-1', amountMinor: 99000, currency: 'RUB' }
    });
  });

  it('stores nothing for a zero invoice, which moved no money', async () => {
    const { listener, notify } = build({
      invoice: { amountMinor: Money.fromMinor(0), currency: 'RUB' }
    });

    await listener.onInvoicePaid(new InvoicePaidEvent('user-1', 'inv-1'));

    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ['a retry is due', 'past_due', new Date('2026-12-04T00:00:00.000Z')],
    ['the attempts are finished', 'canceled', null]
  ] as const)(
    'stores the dunning state when %s',
    async (_name, status, nextRenewalAttemptAt) => {
      const { listener, notify } = build({
        sub: subscription({ status, nextRenewalAttemptAt })
      });

      await listener.onPaymentFailed(new PaymentFailedEvent('user-1', 'sub-1'));

      expect(notify).toHaveBeenCalledWith('user-1', {
        kind: 'payment_failed',
        payload: {
          subscriptionId: 'sub-1',
          planName: 'Pro',
          subscriptionStatus: status,
          nextAttemptAt: nextRenewalAttemptAt?.toISOString() ?? null
        }
      });
    }
  );

  it('stores a failed payment that belongs to no subscription', async () => {
    const { listener, notify } = build();

    await listener.onPaymentFailed(new PaymentFailedEvent('user-1', null));

    expect(notify).toHaveBeenCalledWith('user-1', {
      kind: 'payment_failed',
      payload: {
        subscriptionId: null,
        planName: null,
        subscriptionStatus: null,
        nextAttemptAt: null
      }
    });
  });

  it.each([
    ['the period end for a paid period', subscription(), PERIOD_END],
    [
      'the trial end for a trial',
      subscription({
        status: 'trialing',
        trialEnd: new Date('2026-11-20T00:00:00.000Z')
      }),
      new Date('2026-11-20T00:00:00.000Z')
    ]
  ])(
    'gives a scheduled cancel %s as the last day',
    async (_name, sub, accessEndsAt) => {
      const { listener, notify } = build({
        sub: { ...sub, cancelAtPeriodEnd: true }
      });

      await listener.onCancelScheduled(
        new SubscriptionCancelScheduledEvent('user-1', 'sub-1')
      );

      expect(notify).toHaveBeenCalledWith('user-1', {
        kind: 'subscription_cancel_scheduled',
        payload: {
          subscriptionId: 'sub-1',
          planName: 'Pro',
          accessEndsAt: accessEndsAt.toISOString()
        }
      });
    }
  );

  it.each([
    ['the schedule was taken back', subscription()],
    [
      'the row ended first',
      subscription({ status: 'canceled', cancelAtPeriodEnd: true })
    ]
  ])('stores no scheduled cancel when %s', async (_name, sub) => {
    const { listener, notify } = build({ sub });

    await listener.onCancelScheduled(
      new SubscriptionCancelScheduledEvent('user-1', 'sub-1')
    );

    expect(notify).not.toHaveBeenCalled();
  });

  it('stores the end of a subscription', async () => {
    const { listener, notify } = build({
      sub: subscription({ status: 'canceled' })
    });

    await listener.onCanceled(
      new SubscriptionCanceledEvent('user-1', 'sub-1', true)
    );

    expect(notify).toHaveBeenCalledWith('user-1', {
      kind: 'subscription_canceled',
      payload: { subscriptionId: 'sub-1', planName: 'Pro' }
    });
  });

  it('stores nothing for the cancel of a row that never gave access', async () => {
    const { listener, notify } = build({
      sub: subscription({ status: 'canceled' })
    });

    await listener.onCanceled(
      new SubscriptionCanceledEvent('user-1', 'sub-1', false)
    );

    expect(notify).not.toHaveBeenCalled();
  });

  it('stores the renewal date and the amount of the coming charge', async () => {
    const { listener, notify } = build({ sub: subscription() });

    await listener.onRenewalUpcoming(
      new RenewalUpcomingEvent('user-1', 'sub-1', {
        renewsAt: PERIOD_END,
        amount: { amountMinor: 99000, currency: 'RUB' }
      })
    );

    expect(notify).toHaveBeenCalledWith('user-1', {
      kind: 'renewal_upcoming',
      payload: {
        subscriptionId: 'sub-1',
        planName: 'Pro',
        renewsAt: PERIOD_END.toISOString(),
        amountMinor: 99000,
        currency: 'RUB'
      }
    });
  });

  it.each([
    [
      'a cancel was scheduled after the claim',
      subscription({ cancelAtPeriodEnd: true })
    ],
    ['the row ended', subscription({ status: 'canceled' })],
    ['the row is gone', null]
  ])('stores no renewal notice when %s', async (_name, sub) => {
    const { listener, notify } = build({ sub });

    await listener.onRenewalUpcoming(
      new RenewalUpcomingEvent('user-1', 'sub-1', {
        renewsAt: PERIOD_END,
        amount: { amountMinor: 99000, currency: 'RUB' }
      })
    );

    expect(notify).not.toHaveBeenCalled();
  });

  it('stores the amount of each refund leg', async () => {
    const { listener, notify } = build();

    await listener.onRefundIssued(
      new RefundIssuedEvent('user-1', 'inv-1', {
        amountMinor: 24500,
        currency: 'RUB'
      })
    );

    expect(notify).toHaveBeenCalledWith('user-1', {
      kind: 'refund_issued',
      payload: { invoiceId: 'inv-1', amountMinor: 24500, currency: 'RUB' }
    });
  });

  it.each([
    ['reaches 0', 0, 1],
    ['goes below 0', -200, 1],
    ['stays above 0', 5, 0]
  ])(
    'stores a depleted notice only when the balance %s',
    async (_name, balanceAfter, calls) => {
      const { listener, notify } = build();

      await listener.onCreditBalanceCrossed(
        new CreditBalanceCrossedEvent('user-1', balanceAfter)
      );

      expect(notify).toHaveBeenCalledTimes(calls);
    }
  );

  it('logs a failed store and does not throw it to the emitter', async () => {
    const { listener, notify } = build();

    notify.mockRejectedValue(new Error('db down'));

    await expect(
      listener.onRefundIssued(
        new RefundIssuedEvent('user-1', 'inv-1', {
          amountMinor: 1,
          currency: 'RUB'
        })
      )
    ).resolves.toBeUndefined();
  });
});
