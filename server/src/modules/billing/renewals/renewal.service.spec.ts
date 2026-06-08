import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PaymentFailedEvent,
  SubscriptionCanceledEvent,
  SubscriptionPastDueEvent,
  SubscriptionRenewedEvent
} from '../events/billing.events';
import { BILLING_PROVIDERS } from '../providers/payment-provider.interface';
import { FixedRating } from '../rating/fixed-rating.strategy';
import { RenewalService } from './renewal.service';
import {
  DUNNING_MAX_ATTEMPTS,
  DUNNING_RETRY_DELAY_MS
} from './renewal-queue.constants';

interface Store {
  subscriptions: Subscription[];
  customers: Customer[];
  plans: Plan[];
  invoices: Array<Invoice & { providerEventId: string | null }>;
}

const NOW = new Date('2026-06-08T00:00:00Z');

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return Object.assign(new Subscription(), {
    id: 'sub-1',
    customerId: 'cust-1',
    planKey: 'pro',
    provider: 'yookassa' as BillingProviderId,
    billingMode: 'fixed',
    status: 'active',
    lifecycleOwner: 'self',
    currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    providerSubscriptionId: null,
    paymentMethodId: 'pm-1',
    dunningAttempts: 0,
    nextRenewalAttemptAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });
}

function makeCustomer(): Customer {
  return Object.assign(new Customer(), {
    id: 'cust-1',
    userId: 'user-1',
    provider: 'yookassa' as BillingProviderId,
    providerOverride: null,
    providerCustomerId: null,
    country: 'RU',
    currency: 'RUB',
    defaultPaymentMethodId: 'pm-1',
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

function makePlan(): Plan {
  return Object.assign(new Plan(), {
    id: 'plan-pro',
    key: 'pro',
    name: 'Pro',
    description: null,
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: ['reports'],
    limits: null,
    trialDays: 0,
    active: true,
    prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } },
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

function makeManager(store: Store) {
  let seq = 0;
  return {
    findOne: (entity: unknown, opts: { where: { id: string } }) => {
      if (entity === Subscription) {
        return Promise.resolve(
          store.subscriptions.find((s) => s.id === opts.where.id) ?? null
        );
      }
      return Promise.resolve(null);
    },
    save: (entity: Subscription) => Promise.resolve(entity),
    createQueryBuilder: () => {
      const captured: { values?: Record<string, unknown> } = {};
      const builder = {
        insert: () => builder,
        into: () => builder,
        values: (v: Record<string, unknown>) => {
          captured.values = v;
          return builder;
        },
        orIgnore: () => builder,
        returning: () => builder,
        execute: () => {
          const v = captured.values ?? {};
          const dup = store.invoices.some(
            (i) => i.providerEventId === v['providerEventId']
          );
          if (dup) return Promise.resolve({ raw: [] });
          const id = `inv-${++seq}`;
          store.invoices.push({
            id,
            ...v
          } as unknown as Invoice & { providerEventId: string | null });
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    }
  };
}

function subscriptionsRepo(store: Store) {
  return {
    findOne: (opts: { where: { id: string } }) =>
      Promise.resolve(
        store.subscriptions.find((s) => s.id === opts.where.id) ?? null
      ),
    save: (entity: Subscription) => Promise.resolve(entity),
    createQueryBuilder: () => {
      const qb = {
        where: () => qb,
        andWhere: () => qb,
        setParameters: () => qb,
        orderBy: () => qb,
        // Mirrors the non-time WHERE clauses (self + fixed + open status); the
        // time-based due check is real code in RenewalService.processSubscription.
        getMany: () =>
          Promise.resolve(
            store.subscriptions.filter(
              (s) =>
                s.lifecycleOwner === 'self' &&
                s.billingMode === 'fixed' &&
                ['trialing', 'active', 'past_due'].includes(s.status)
            )
          )
      };
      return qb;
    }
  };
}

async function build(
  store: Store,
  chargeOffSession: jest.Mock
): Promise<{ service: RenewalService; emit: jest.Mock; charge: jest.Mock }> {
  const emit = jest.fn();
  const manager = makeManager(store);
  const dataSource = {
    transaction: (cb: (m: typeof manager) => unknown) => cb(manager)
  };
  const provider = {
    id: 'yookassa' as BillingProviderId,
    managesLifecycle: false,
    ensureCustomer: jest.fn(),
    startCheckout: jest.fn(),
    chargeOffSession,
    cancel: jest.fn(),
    refund: jest.fn(),
    verifyAndParseWebhook: jest.fn()
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      RenewalService,
      FixedRating,
      {
        provide: getRepositoryToken(Subscription),
        useValue: subscriptionsRepo(store)
      },
      {
        provide: getRepositoryToken(Customer),
        useValue: {
          findOne: (opts: { where: { id: string } }) =>
            Promise.resolve(
              store.customers.find((c) => c.id === opts.where.id) ?? null
            )
        }
      },
      {
        provide: getRepositoryToken(Plan),
        useValue: {
          findOne: (opts: { where: { key: string } }) =>
            Promise.resolve(
              store.plans.find((p) => p.key === opts.where.key) ?? null
            )
        }
      },
      { provide: getDataSourceToken(), useValue: dataSource },
      { provide: BILLING_PROVIDERS, useValue: [provider] },
      { provide: EventEmitter2, useValue: { emit } }
    ]
  }).compile();

  return {
    service: moduleRef.get(RenewalService),
    emit,
    charge: chargeOffSession
  };
}

function baseStore(sub: Subscription): Store {
  return {
    subscriptions: [sub],
    customers: [makeCustomer()],
    plans: [makePlan()],
    invoices: []
  };
}

describe('RenewalService', () => {
  it('charges a due active subscription, advances the period, emits renewed', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    const charge = jest.fn().mockResolvedValue({ providerInvoiceRef: 'pay_1' });
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cust-1' }),
      99000,
      [{ description: 'Pro', amountMinor: 99000, quantity: 1 }],
      'renewal:sub-1:' + new Date('2026-06-01T00:00:00Z').getTime() + ':0'
    );
    expect(store.invoices).toHaveLength(1);
    expect(store.invoices[0]).toMatchObject({
      amountMinor: 99000,
      currency: 'RUB',
      status: 'paid',
      providerInvoiceRef: 'pay_1'
    });
    expect(sub.status).toBe('active');
    expect(sub.currentPeriodStart).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(sub.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(sub.dunningAttempts).toBe(0);
    expect(emit).toHaveBeenCalledWith(
      InvoicePaidEvent.name,
      expect.objectContaining({ userId: 'user-1' })
    );
    expect(emit).toHaveBeenCalledWith(
      SubscriptionRenewedEvent.name,
      expect.objectContaining({ userId: 'user-1', subscriptionId: 'sub-1' })
    );
  });

  it('converts a trial at trial_end, anchoring the period there', async () => {
    const sub = makeSub({
      status: 'trialing',
      trialEnd: new Date('2026-06-05T00:00:00Z'),
      currentPeriodEnd: new Date('2026-07-05T00:00:00Z')
    });
    const store = baseStore(sub);
    const charge = jest
      .fn()
      .mockResolvedValue({ providerInvoiceRef: 'pay_trial' });
    const { service } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(1);
    expect(sub.status).toBe('active');
    expect(sub.trialEnd).toBeNull();
    expect(sub.currentPeriodStart).toEqual(new Date('2026-06-05T00:00:00Z'));
    expect(sub.currentPeriodEnd).toEqual(new Date('2026-07-05T00:00:00Z'));
  });

  it('charges a past_due subscription whose retry is due (dunning recovery)', async () => {
    const sub = makeSub({
      status: 'past_due',
      dunningAttempts: 1,
      nextRenewalAttemptAt: new Date('2026-06-07T00:00:00Z')
    });
    const store = baseStore(sub);
    const charge = jest
      .fn()
      .mockResolvedValue({ providerInvoiceRef: 'pay_retry' });
    const { service } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(1);
    expect(sub.status).toBe('active');
    expect(sub.dunningAttempts).toBe(0);
    expect(sub.nextRenewalAttemptAt).toBeNull();
  });

  it('does not charge a subscription that is not yet due', async () => {
    const sub = makeSub({
      currentPeriodEnd: new Date('2026-07-01T00:00:00Z')
    });
    const store = baseStore(sub);
    const charge = jest.fn();
    const { service } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).not.toHaveBeenCalled();
    expect(store.invoices).toHaveLength(0);
  });

  it('skips provider-managed subscriptions (renewed via webhook)', async () => {
    const sub = makeSub({
      provider: 'paddle',
      lifecycleOwner: 'provider'
    });
    const store = baseStore(sub);
    const charge = jest.fn();
    const { service } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).not.toHaveBeenCalled();
  });

  it('moves a subscription to past_due and schedules a retry on a failed charge', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    const charge = jest.fn().mockRejectedValue(new Error('declined'));
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(sub.status).toBe('past_due');
    expect(sub.dunningAttempts).toBe(1);
    expect(sub.nextRenewalAttemptAt).toEqual(
      new Date(NOW.getTime() + DUNNING_RETRY_DELAY_MS)
    );
    expect(store.invoices).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith(
      PaymentFailedEvent.name,
      expect.objectContaining({ userId: 'user-1' })
    );
    expect(emit).toHaveBeenCalledWith(
      SubscriptionPastDueEvent.name,
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('cancels after the dunning attempts are exhausted', async () => {
    const sub = makeSub({
      status: 'past_due',
      dunningAttempts: DUNNING_MAX_ATTEMPTS - 1,
      nextRenewalAttemptAt: new Date('2026-06-07T00:00:00Z')
    });
    const store = baseStore(sub);
    const charge = jest.fn().mockRejectedValue(new Error('declined'));
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(sub.status).toBe('canceled');
    expect(sub.dunningAttempts).toBe(DUNNING_MAX_ATTEMPTS);
    expect(emit).toHaveBeenCalledWith(
      SubscriptionCanceledEvent.name,
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('cancels at the period boundary instead of charging when cancel_at_period_end', async () => {
    const sub = makeSub({ cancelAtPeriodEnd: true });
    const store = baseStore(sub);
    const charge = jest.fn();
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).not.toHaveBeenCalled();
    expect(sub.status).toBe('canceled');
    expect(emit).toHaveBeenCalledWith(
      SubscriptionCanceledEvent.name,
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('is idempotent across a double scan (charges and advances once)', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    const charge = jest.fn().mockResolvedValue({ providerInvoiceRef: 'pay_1' });
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);
    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(1);
    expect(store.invoices).toHaveLength(1);
    expect(
      emit.mock.calls.filter(
        (call: unknown[]) => call[0] === InvoicePaidEvent.name
      )
    ).toHaveLength(1);
  });

  it('does not re-advance the period when the renewal invoice already exists', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    // Simulate a crash after the charge succeeded but before the period advanced:
    // the invoice for this exact attempt is already persisted.
    const anchorMs = new Date('2026-06-01T00:00:00Z').getTime();
    store.invoices.push({
      id: 'inv-pre',
      providerEventId: `renewal:sub-1:${anchorMs}:0`
    } as unknown as Invoice & { providerEventId: string | null });
    const charge = jest.fn().mockResolvedValue({ providerInvoiceRef: 'pay_1' });
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);

    // Charge is idempotent on the provider side; the period must not advance again.
    expect(store.invoices).toHaveLength(1);
    expect(sub.currentPeriodEnd).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(
      emit.mock.calls.filter(
        (call: unknown[]) => call[0] === InvoicePaidEvent.name
      )
    ).toHaveLength(0);
  });
});
