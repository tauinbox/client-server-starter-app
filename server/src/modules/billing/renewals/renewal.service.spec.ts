import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Money } from '@app/shared/utils/money';
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
import { UsageRating } from '../rating/usage-rating.strategy';
import { UsageRecord } from '../entities/usage-record.entity';
import { CreditService } from '../services/credit.service';
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
  deletedUserIds: Set<string>;
  // Join conditions findDue issued, so tests can assert the production query
  // carries the soft-deleted-user guard the getMany mirror reimplements.
  capturedJoins: string[];
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
    findOne: (
      entity: unknown,
      opts: { where: { id?: string; providerEventId?: string } }
    ) => {
      if (entity === Subscription) {
        return Promise.resolve(
          store.subscriptions.find((s) => s.id === opts.where.id) ?? null
        );
      }
      if (entity === Invoice) {
        return Promise.resolve(
          store.invoices.find(
            (i) =>
              (opts.where.providerEventId === undefined ||
                i.providerEventId === opts.where.providerEventId) &&
              (opts.where.id === undefined || i.id === opts.where.id)
          ) ?? null
        );
      }
      return Promise.resolve(null);
    },
    save: (entity: Subscription) => Promise.resolve(entity),
    update: (
      entity: unknown,
      criteria: Record<string, unknown>,
      values: Record<string, unknown>
    ) => {
      // A `status: In([...])` criterion arrives as a FindOperator; unwrap it.
      const statusCriterion = criteria['status'];
      const statuses =
        statusCriterion === undefined
          ? null
          : typeof statusCriterion === 'string'
            ? [statusCriterion]
            : ((statusCriterion as { value: string[] }).value ?? []);
      if (entity === Subscription) {
        const match = store.subscriptions.find(
          (s) =>
            s.id === criteria['id'] &&
            (criteria['currentPeriodEnd'] === undefined ||
              s.currentPeriodEnd.getTime() ===
                (criteria['currentPeriodEnd'] as Date).getTime())
        );
        if (match) Object.assign(match, values);
        return Promise.resolve({ affected: match ? 1 : 0 });
      }
      if (entity === Invoice) {
        const matches = store.invoices.filter(
          (i) =>
            (criteria['providerEventId'] === undefined ||
              i.providerEventId === criteria['providerEventId']) &&
            (criteria['id'] === undefined || i.id === criteria['id']) &&
            (statuses === null || statuses.includes(i.status))
        );
        matches.forEach((i) => Object.assign(i, values));
        return Promise.resolve({ affected: matches.length });
      }
      return Promise.resolve({ affected: 0 });
    },
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
          // @ts-expect-error - partial Invoice fake assembled from insert().values()
          const row: Invoice & { providerEventId: string | null } = {
            id,
            ...v
          };
          store.invoices.push(row);
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
        innerJoin: (_entity: unknown, _alias: string, condition: string) => {
          store.capturedJoins.push(condition);
          return qb;
        },
        where: () => qb,
        andWhere: () => qb,
        setParameters: () => qb,
        orderBy: () => qb,
        // Mirrors the non-time WHERE clauses (self + fixed + open status) and
        // the soft-deleted-user join; the time-based due check is real code in
        // RenewalService.processSubscription.
        getMany: () =>
          Promise.resolve(
            store.subscriptions.filter((s) => {
              const customer = store.customers.find(
                (c) => c.id === s.customerId
              );
              return (
                s.lifecycleOwner === 'self' &&
                ['trialing', 'active', 'past_due'].includes(s.status) &&
                customer !== undefined &&
                !store.deletedUserIds.has(customer.userId)
              );
            })
          )
      };
      return qb;
    }
  };
}

async function build(
  store: Store,
  chargeOffSession: jest.Mock,
  usageSum: jest.Mock = jest.fn().mockResolvedValue(null),
  availableCredits = 0,
  findOffSessionCharge: jest.Mock = jest.fn().mockResolvedValue(null)
): Promise<{
  service: RenewalService;
  emit: jest.Mock;
  charge: jest.Mock;
  findCharge: jest.Mock;
  credits: { availableUnits: jest.Mock; spendOnUsage: jest.Mock };
}> {
  const emit = jest.fn();
  const credits = {
    availableUnits: jest.fn().mockResolvedValue(availableCredits),
    spendOnUsage: jest.fn().mockResolvedValue(undefined)
  };
  const manager = makeManager(store);
  const dataSource = {
    transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
    manager
  };
  const provider = {
    id: 'yookassa' as BillingProviderId,
    managesLifecycle: false,
    ensureCustomer: jest.fn(),
    startCheckout: jest.fn(),
    chargeOffSession,
    findOffSessionCharge,
    cancel: jest.fn(),
    refund: jest.fn(),
    verifyAndParseWebhook: jest.fn()
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      RenewalService,
      FixedRating,
      UsageRating,
      {
        // UsageRating now aggregates via a raw bigint SUM query; drive the same
        // `usageSum` control knob through the query-builder's getRawOne wire shape.
        provide: getRepositoryToken(UsageRecord),
        useValue: {
          createQueryBuilder: () => {
            const qb = {
              select: () => qb,
              where: () => qb,
              andWhere: () => qb,
              getRawOne: async () => ({
                total: String((await usageSum()) ?? 0)
              })
            };
            return qb;
          }
        }
      },
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
      { provide: CreditService, useValue: credits },
      { provide: EventEmitter2, useValue: { emit } }
    ]
  }).compile();

  return {
    service: moduleRef.get(RenewalService),
    emit,
    charge: chargeOffSession,
    findCharge: findOffSessionCharge,
    credits
  };
}

function baseStore(sub: Subscription): Store {
  return {
    subscriptions: [sub],
    customers: [makeCustomer()],
    plans: [makePlan()],
    invoices: [],
    deletedUserIds: new Set(),
    capturedJoins: []
  };
}

describe('RenewalService', () => {
  it('charges a due active subscription, advances the period, emits renewed', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    const charge = jest
      .fn()
      .mockResolvedValue({ providerInvoiceRef: 'pay_1', status: 'captured' });
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cust-1' }),
      99000,
      [{ description: 'Pro', amountMinor: 99000, quantity: 1 }],
      'renewal:sub-1:' + new Date('2026-06-01T00:00:00Z').getTime()
    );
    expect(store.invoices).toHaveLength(1);
    expect(store.invoices[0]).toMatchObject({
      amountMinor: Money.fromMinor(99000),
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
    const charge = jest.fn().mockResolvedValue({
      providerInvoiceRef: 'pay_trial',
      status: 'captured'
    });
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
    const charge = jest.fn().mockResolvedValue({
      providerInvoiceRef: 'pay_retry',
      status: 'captured'
    });
    const { service } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(1);
    expect(sub.status).toBe('active');
    expect(sub.dunningAttempts).toBe(0);
    expect(sub.nextRenewalAttemptAt).toBeNull();
  });

  describe('dunning-retry reconciliation (stable idempotency key)', () => {
    it('sends the same idempotency key on the retry of a failed period', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const charge = jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({
          providerInvoiceRef: 'pay_2',
          status: 'captured'
        });
      const { service } = await build(store, charge);

      await service.runDueRenewals(NOW);
      expect(sub.status).toBe('past_due');
      await service.runDueRenewals(
        new Date(NOW.getTime() + DUNNING_RETRY_DELAY_MS)
      );

      expect(charge).toHaveBeenCalledTimes(2);
      const keys = charge.mock.calls.map((call: unknown[]) => call[3]);
      expect(keys[1]).toBe(keys[0]);
      expect(sub.status).toBe('active');
    });

    it('reconciles a captured prior attempt instead of charging again', async () => {
      const sub = makeSub({
        status: 'past_due',
        dunningAttempts: 1,
        nextRenewalAttemptAt: new Date('2026-06-07T00:00:00Z')
      });
      const store = baseStore(sub);
      const charge = jest.fn();
      const findCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_prior',
        status: 'captured'
      });
      const { service, emit } = await build(
        store,
        charge,
        undefined,
        0,
        findCharge
      );

      await service.runDueRenewals(NOW);

      expect(findCharge).toHaveBeenCalledWith(
        'renewal:sub-1:' + new Date('2026-06-01T00:00:00Z').getTime(),
        new Date('2026-06-01T00:00:00Z')
      );
      expect(charge).not.toHaveBeenCalled();
      expect(store.invoices).toHaveLength(1);
      expect(store.invoices[0]).toMatchObject({
        providerInvoiceRef: 'pay_prior',
        status: 'paid'
      });
      expect(sub.status).toBe('active');
      expect(sub.dunningAttempts).toBe(0);
      expect(emit).toHaveBeenCalledWith(
        SubscriptionRenewedEvent.name,
        expect.objectContaining({ subscriptionId: 'sub-1' })
      );
    });

    it('skips the cycle without touching dunning state when the reconcile fails', async () => {
      const sub = makeSub({
        status: 'past_due',
        dunningAttempts: 1,
        nextRenewalAttemptAt: new Date('2026-06-07T00:00:00Z')
      });
      const store = baseStore(sub);
      const charge = jest.fn();
      const findCharge = jest.fn().mockRejectedValue(new Error('api down'));
      const { service, emit } = await build(
        store,
        charge,
        undefined,
        0,
        findCharge
      );

      await service.runDueRenewals(NOW);

      expect(charge).not.toHaveBeenCalled();
      expect(store.invoices).toHaveLength(0);
      expect(sub.status).toBe('past_due');
      expect(sub.dunningAttempts).toBe(1);
      expect(sub.nextRenewalAttemptAt).toEqual(
        new Date('2026-06-07T00:00:00Z')
      );
      expect(emit).not.toHaveBeenCalled();
    });

    it('does not reconcile on a first attempt', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const charge = jest
        .fn()
        .mockResolvedValue({ providerInvoiceRef: 'pay_1', status: 'captured' });
      const findCharge = jest.fn();
      const { service } = await build(store, charge, undefined, 0, findCharge);

      await service.runDueRenewals(NOW);

      expect(findCharge).not.toHaveBeenCalled();
      expect(charge).toHaveBeenCalledTimes(1);
    });
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

  it('does not sweep a self-managed subscription whose owning user is soft-deleted', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    store.deletedUserIds.add('user-1');
    const charge = jest.fn();
    const { service } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).not.toHaveBeenCalled();
    // The production filter is the SQL join findDue issues; assert it exists
    // so the mirrored getMany above cannot drift from the real query.
    expect(store.capturedJoins).toEqual(
      expect.arrayContaining([expect.stringContaining('u.deletedAt IS NULL')])
    );
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

  describe('usage-mode subscriptions (postpaid period close)', () => {
    function makeUsagePlan(): Plan {
      return Object.assign(new Plan(), {
        id: 'plan-usage',
        key: 'usage',
        name: 'Pay as you go',
        description: null,
        billingMode: 'usage',
        interval: 'month',
        meterKey: 'api_calls',
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: {
          yookassa: {
            currency: 'RUB',
            amountMinor: 0,
            unitPriceMinor: 200,
            includedUnits: 100
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    function usageStore(sub: Subscription): Store {
      const store = baseStore(sub);
      store.plans.push(makeUsagePlan());
      return store;
    }

    const usageSub = () =>
      makeSub({ planKey: 'usage', billingMode: 'usage' as const });

    it('charges the overage of the closed period and invoices that period', async () => {
      const sub = usageSub();
      const store = usageStore(sub);
      const charge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_usage',
        status: 'captured'
      });
      const sum = jest.fn().mockResolvedValue(142);
      const { service, emit } = await build(store, charge, sum);

      await service.runDueRenewals(NOW);

      expect(charge).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cust-1' }),
        8400,
        [
          {
            description: 'Pay as you go: api_calls × 42',
            amountMinor: 8400,
            quantity: 1
          }
        ],
        'renewal:sub-1:' + new Date('2026-06-01T00:00:00Z').getTime()
      );
      // The invoice covers the metered period that just closed, not the new one.
      expect(store.invoices[0]).toMatchObject({
        amountMinor: Money.fromMinor(8400),
        billingMode: 'usage',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z')
      });
      // The subscription itself advances to the next period.
      expect(sub.currentPeriodStart).toEqual(new Date('2026-06-01T00:00:00Z'));
      expect(sub.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
      expect(emit).toHaveBeenCalledWith(
        SubscriptionRenewedEvent.name,
        expect.objectContaining({ subscriptionId: 'sub-1' })
      );
    });

    it('rates the closed period [currentPeriodStart, anchor)', async () => {
      const sub = usageSub();
      const store = usageStore(sub);
      const sum = jest.fn().mockResolvedValue(150);
      const { service } = await build(
        store,
        jest.fn().mockResolvedValue({
          providerInvoiceRef: 'pay_u',
          status: 'captured'
        }),
        sum
      );

      await service.runDueRenewals(NOW);

      // The exact [start, end) window is asserted in usage-rating.strategy.spec;
      // here it is enough that the closed period was rated at all.
      expect(sum).toHaveBeenCalled();
    });

    it('closes a zero-usage period without a provider charge via a zero invoice', async () => {
      const sub = usageSub();
      const store = usageStore(sub);
      const charge = jest.fn();
      const sum = jest.fn().mockResolvedValue(null);
      const { service, emit } = await build(store, charge, sum);

      await service.runDueRenewals(NOW);

      expect(charge).not.toHaveBeenCalled();
      expect(store.invoices).toHaveLength(1);
      expect(store.invoices[0]).toMatchObject({
        amountMinor: Money.fromMinor(0),
        status: 'paid',
        billingMode: 'usage'
      });
      expect(sub.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1' })
      );
    });

    it('spends partial credits with the renewal and charges only the remainder', async () => {
      const sub = usageSub();
      const store = usageStore(sub);
      const charge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_usage',
        status: 'captured'
      });
      const sum = jest.fn().mockResolvedValue(142);
      const { service, credits } = await build(store, charge, sum, 10);

      await service.runDueRenewals(NOW);

      // 42 billable − 10 credits = 32 charged at 200 minor.
      expect(charge).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cust-1' }),
        6400,
        [
          {
            description: 'Pay as you go: api_calls × 32',
            amountMinor: 6400,
            quantity: 1
          }
        ],
        expect.any(String)
      );
      expect(credits.spendOnUsage).toHaveBeenCalledWith(
        expect.anything(),
        'cust-1',
        'inv-1',
        10
      );
      expect(store.invoices[0]).toMatchObject({
        amountMinor: Money.fromMinor(6400)
      });
    });

    it('skips the provider entirely when credits cover the whole period', async () => {
      const sub = usageSub();
      const store = usageStore(sub);
      const charge = jest.fn();
      const sum = jest.fn().mockResolvedValue(142);
      const { service, credits, emit } = await build(store, charge, sum, 1000);

      await service.runDueRenewals(NOW);

      expect(charge).not.toHaveBeenCalled();
      expect(credits.spendOnUsage).toHaveBeenCalledWith(
        expect.anything(),
        'cust-1',
        'inv-1',
        42
      );
      expect(store.invoices[0]).toMatchObject({
        amountMinor: Money.fromMinor(0),
        status: 'paid'
      });
      expect(sub.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
      expect(emit).toHaveBeenCalledWith(
        SubscriptionRenewedEvent.name,
        expect.objectContaining({ subscriptionId: 'sub-1' })
      );
    });

    it('spends no credits when the charge fails (no invoice, no deduction)', async () => {
      const sub = usageSub();
      const store = usageStore(sub);
      const charge = jest.fn().mockRejectedValue(new Error('declined'));
      const sum = jest.fn().mockResolvedValue(142);
      const { service, credits } = await build(store, charge, sum, 10);

      await service.runDueRenewals(NOW);

      expect(credits.spendOnUsage).not.toHaveBeenCalled();
      expect(store.invoices).toHaveLength(0);
    });

    it('walks the dunning ladder when the usage charge fails', async () => {
      const sub = usageSub();
      const store = usageStore(sub);
      const charge = jest.fn().mockRejectedValue(new Error('declined'));
      const sum = jest.fn().mockResolvedValue(142);
      const { service, emit } = await build(store, charge, sum);

      await service.runDueRenewals(NOW);

      expect(sub.status).toBe('past_due');
      expect(sub.dunningAttempts).toBe(1);
      expect(store.invoices).toHaveLength(0);
      expect(emit).toHaveBeenCalledWith(
        PaymentFailedEvent.name,
        expect.objectContaining({ userId: 'user-1' })
      );
    });
  });

  it('renews a fixed $0 plan without a provider charge via a zero invoice', async () => {
    const sub = makeSub({ planKey: 'free' });
    const store = baseStore(sub);
    store.plans.push(
      Object.assign(new Plan(), {
        ...makePlan(),
        id: 'plan-free',
        key: 'free',
        name: 'Free',
        prices: { yookassa: { currency: 'RUB', amountMinor: 0 } }
      })
    );
    const charge = jest.fn();
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).not.toHaveBeenCalled();
    expect(store.invoices).toHaveLength(1);
    expect(store.invoices[0]).toMatchObject({
      amountMinor: Money.fromMinor(0),
      status: 'paid',
      billingMode: 'fixed'
    });
    expect(sub.status).toBe('active');
    expect(sub.currentPeriodStart).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(sub.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(sub.dunningAttempts).toBe(0);
    expect(
      emit.mock.calls.filter(
        (call: unknown[]) => call[0] === PaymentFailedEvent.name
      )
    ).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith(
      SubscriptionRenewedEvent.name,
      expect.objectContaining({ userId: 'user-1', subscriptionId: 'sub-1' })
    );
  });

  it('is idempotent across a double scan (charges and advances once)', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    const charge = jest
      .fn()
      .mockResolvedValue({ providerInvoiceRef: 'pay_1', status: 'captured' });
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

  it('advances without charging when the webhook already settled the invoice', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    // A pending charge settled by the payment.succeeded webhook: the invoice
    // is paid (InvoicePaidEvent already emitted by the reducer), only the
    // period advance is left for the scan.
    const anchorMs = new Date('2026-06-01T00:00:00Z').getTime();
    // @ts-expect-error - partial Invoice fake for this scenario
    const preInvoice: Invoice & { providerEventId: string | null } = {
      id: 'inv-pre',
      providerEventId: `renewal:sub-1:${anchorMs}`,
      status: 'paid',
      providerInvoiceRef: 'pay_wh',
      creditUnitsApplied: 0
    };
    store.invoices.push(preInvoice);
    const charge = jest.fn();
    const { service, emit, credits } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).not.toHaveBeenCalled();
    expect(store.invoices).toHaveLength(1);
    expect(sub.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(credits.spendOnUsage).not.toHaveBeenCalled();
    expect(
      emit.mock.calls.filter(
        (call: unknown[]) => call[0] === InvoicePaidEvent.name
      )
    ).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith(
      SubscriptionRenewedEvent.name,
      expect.objectContaining({ subscriptionId: 'sub-1' })
    );
  });

  describe('pending (uncaptured) off-session charges', () => {
    const pendingCharge = () =>
      jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_pend',
        status: 'pending'
      });

    it('records a pending invoice without advancing or emitting when the charge is uncaptured', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const { service, emit, credits } = await build(store, pendingCharge());

      await service.runDueRenewals(NOW);

      expect(store.invoices).toHaveLength(1);
      expect(store.invoices[0]).toMatchObject({
        status: 'pending',
        paidAt: null,
        providerInvoiceRef: 'pay_pend',
        amountMinor: Money.fromMinor(99000)
      });
      expect(sub.status).toBe('active');
      expect(sub.currentPeriodEnd).toEqual(new Date('2026-06-01T00:00:00Z'));
      expect(credits.spendOnUsage).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('settles the pending invoice and advances when the poll finds it captured', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const findCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_pend',
        status: 'captured'
      });
      const { service, emit, charge } = await build(
        store,
        pendingCharge(),
        undefined,
        0,
        findCharge
      );

      await service.runDueRenewals(NOW);
      await service.runDueRenewals(NOW);

      expect(charge).toHaveBeenCalledTimes(1);
      expect(store.invoices).toHaveLength(1);
      expect(store.invoices[0]).toMatchObject({
        status: 'paid',
        providerInvoiceRef: 'pay_pend'
      });
      expect(sub.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1' })
      );
      expect(emit).toHaveBeenCalledWith(
        SubscriptionRenewedEvent.name,
        expect.objectContaining({ subscriptionId: 'sub-1' })
      );
    });

    it('keeps waiting while the poll reports the charge still pending', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const findCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_pend',
        status: 'pending'
      });
      const { service, emit, charge } = await build(
        store,
        pendingCharge(),
        undefined,
        0,
        findCharge
      );

      await service.runDueRenewals(NOW);
      await service.runDueRenewals(NOW);

      expect(charge).toHaveBeenCalledTimes(1);
      expect(store.invoices[0]).toMatchObject({ status: 'pending' });
      expect(sub.currentPeriodEnd).toEqual(new Date('2026-06-01T00:00:00Z'));
      expect(emit).not.toHaveBeenCalled();
    });

    it('fails the invoice and enters dunning when the pending charge cancels at capture', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const findCharge = jest.fn().mockResolvedValue(null);
      const { service, emit, credits } = await build(
        store,
        pendingCharge(),
        undefined,
        0,
        findCharge
      );

      await service.runDueRenewals(NOW);
      await service.runDueRenewals(NOW);

      // The invoice must never surface as paid and the subscription must not
      // keep the period for free: dunning starts.
      expect(store.invoices[0]).toMatchObject({ status: 'failed' });
      expect(sub.status).toBe('past_due');
      expect(sub.dunningAttempts).toBe(1);
      expect(sub.nextRenewalAttemptAt).toEqual(
        new Date(NOW.getTime() + DUNNING_RETRY_DELAY_MS)
      );
      expect(credits.spendOnUsage).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        PaymentFailedEvent.name,
        expect.objectContaining({ userId: 'user-1' })
      );
    });

    it('enters dunning without re-charging when the webhook recorded the decline first', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const anchorMs = new Date('2026-06-01T00:00:00Z').getTime();
      // @ts-expect-error - partial Invoice fake for this scenario
      const preInvoice: Invoice & { providerEventId: string | null } = {
        id: 'inv-pre',
        providerEventId: `renewal:sub-1:${anchorMs}`,
        status: 'failed',
        providerInvoiceRef: 'pay_pend',
        creditUnitsApplied: 0
      };
      store.invoices.push(preInvoice);
      const charge = jest.fn();
      const { service, emit } = await build(store, charge);

      await service.runDueRenewals(NOW);

      expect(charge).not.toHaveBeenCalled();
      expect(sub.status).toBe('past_due');
      expect(sub.dunningAttempts).toBe(1);
      expect(emit).toHaveBeenCalledWith(
        PaymentFailedEvent.name,
        expect.objectContaining({ userId: 'user-1' })
      );
    });

    it('spends the stored credit units on settle, not re-rated ones', async () => {
      const sub = makeSub({ planKey: 'usage', billingMode: 'usage' });
      const store = baseStore(sub);
      store.plans.push(
        Object.assign(new Plan(), {
          ...makePlan(),
          id: 'plan-usage',
          key: 'usage',
          billingMode: 'usage',
          meterKey: 'api_calls',
          prices: {
            yookassa: {
              currency: 'RUB',
              amountMinor: 0,
              unitPriceMinor: 200,
              includedUnits: 100
            }
          }
        })
      );
      const sum = jest.fn().mockResolvedValue(142);
      const findCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_pend',
        status: 'captured'
      });
      const { service, credits } = await build(
        store,
        pendingCharge(),
        sum,
        10,
        findCharge
      );

      await service.runDueRenewals(NOW);
      expect(store.invoices[0]).toMatchObject({
        status: 'pending',
        creditUnitsApplied: 10
      });
      expect(credits.spendOnUsage).not.toHaveBeenCalled();

      // The balance drifts before the settle; the recorded charge was rated
      // against 10 units and must spend exactly those.
      credits.availableUnits.mockResolvedValue(25);
      await service.runDueRenewals(NOW);

      expect(credits.spendOnUsage).toHaveBeenCalledTimes(1);
      expect(credits.spendOnUsage).toHaveBeenCalledWith(
        expect.anything(),
        'cust-1',
        'inv-1',
        10
      );
      expect(store.invoices[0]).toMatchObject({ status: 'paid' });
    });

    it('records a pending prior attempt found by the dunning reconcile and waits', async () => {
      const sub = makeSub({
        status: 'past_due',
        dunningAttempts: 1,
        nextRenewalAttemptAt: new Date('2026-06-07T00:00:00Z')
      });
      const store = baseStore(sub);
      const charge = jest.fn();
      const findCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_prior',
        status: 'pending'
      });
      const { service, emit } = await build(
        store,
        charge,
        undefined,
        0,
        findCharge
      );

      await service.runDueRenewals(NOW);

      expect(charge).not.toHaveBeenCalled();
      expect(store.invoices[0]).toMatchObject({
        status: 'pending',
        providerInvoiceRef: 'pay_prior'
      });
      expect(sub.status).toBe('past_due');
      expect(sub.dunningAttempts).toBe(1);
      expect(emit).not.toHaveBeenCalled();
    });
  });
});
