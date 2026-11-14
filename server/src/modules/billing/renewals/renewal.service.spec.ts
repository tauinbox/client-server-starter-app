import { expect } from '@jest/globals';
import { Logger } from '@nestjs/common';
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
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from '../providers/payment-provider.interface';
import { withProviderDeadline } from '../providers/provider-deadline';
import { FixedRating } from '../rating/fixed-rating.strategy';
import { RenewalService } from './renewal.service';
import {
  DUNNING_MAX_ATTEMPTS,
  DUNNING_RETRY_DELAY_MS,
  PLAN_CHANGE_LEASE_MS,
  RENEWAL_SCAN_MAX_PER_RUN
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
    provider: 'yookassa',
    billingMode: 'fixed',
    status: 'active',
    lifecycleOwner: 'self',
    currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
    billingAnchorAt: new Date('2026-05-01T00:00:00Z'),
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
    provider: 'yookassa',
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

/**
 * Each read hands back its own entity, as a real repository does: two scans
 * loading the same row must not share one object, or a write by the first
 * would silently update what the second believes it read.
 */
function readSubscription(store: Store, id: unknown): Subscription | null {
  const row = store.subscriptions.find((s) => s.id === id);

  return row ? Object.assign(new Subscription(), row) : null;
}

/** A `status: In([...])` criterion arrives as a FindOperator; unwrap it. */
function criterionStatuses(criterion: unknown): string[] | null {
  if (criterion === undefined) return null;

  if (typeof criterion === 'string') return [criterion];

  return (criterion as { value: string[] }).value ?? [];
}

function matchesSubscription(
  s: Subscription,
  criteria: Record<string, unknown>
): boolean {
  const statuses = criterionStatuses(criteria['status']);

  return (
    s.id === criteria['id'] &&
    (criteria['currentPeriodEnd'] === undefined ||
      s.currentPeriodEnd.getTime() ===
        (criteria['currentPeriodEnd'] as Date).getTime()) &&
    (criteria['dunningAttempts'] === undefined ||
      s.dunningAttempts === criteria['dunningAttempts']) &&
    (criteria['cancelAtPeriodEnd'] === undefined ||
      s.cancelAtPeriodEnd === criteria['cancelAtPeriodEnd']) &&
    (statuses === null || statuses.includes(s.status))
  );
}

function updateSubscriptions(
  store: Store,
  criteria: Record<string, unknown>,
  values: Record<string, unknown>
): Promise<{ affected: number }> {
  const match = store.subscriptions.find((s) =>
    matchesSubscription(s, criteria)
  );

  if (match) Object.assign(match, values);

  return Promise.resolve({ affected: match ? 1 : 0 });
}

function makeManager(store: Store) {
  let seq = 0;

  return {
    findOne: (
      entity: unknown,
      opts: { where: { id?: string; providerEventId?: string } }
    ) => {
      if (entity === Subscription) {
        return Promise.resolve(readSubscription(store, opts.where.id));
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
    save: (entity: Subscription) => {
      const row = store.subscriptions.find((s) => s.id === entity.id);

      if (row) Object.assign(row, entity);

      return Promise.resolve(entity);
    },
    update: (
      entity: unknown,
      criteria: Record<string, unknown>,
      values: Record<string, unknown>
    ) => {
      const statuses = criterionStatuses(criteria['status']);

      if (entity === Subscription) {
        return updateSubscriptions(store, criteria, values);
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
      Promise.resolve(readSubscription(store, opts.where.id)),
    save: (entity: Subscription) => {
      const row = store.subscriptions.find((s) => s.id === entity.id);

      if (row) Object.assign(row, entity);

      return Promise.resolve(entity);
    },
    update: (
      criteria: Record<string, unknown>,
      values: Record<string, unknown>
    ) => updateSubscriptions(store, criteria, values),
    createQueryBuilder: () => {
      let take: number | null = null;
      const qb = {
        innerJoin: (_entity: unknown, _alias: string, condition: string) => {
          store.capturedJoins.push(condition);

          return qb;
        },
        where: () => qb,
        andWhere: () => qb,
        setParameters: () => qb,
        orderBy: () => qb,
        limit: (n: number) => {
          take = n;

          return qb;
        },
        // Mirrors the non-time WHERE clauses (self + fixed + open status), the
        // soft-deleted-user join, the `currentPeriodEnd ASC` order and the
        // per-run LIMIT; the time-based due check is real code in
        // RenewalService.processSubscription.
        getMany: () => {
          const rows = store.subscriptions
            .filter((s) => {
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
            .toSorted(
              (a, b) =>
                a.currentPeriodEnd.getTime() - b.currentPeriodEnd.getTime()
            );

          return Promise.resolve(take === null ? rows : rows.slice(0, take));
        }
      };

      return qb;
    }
  };
}

async function build(
  store: Store,
  chargeOffSession: jest.Mock,
  {
    findOffSessionCharge = jest.fn().mockResolvedValue(null),
    deadlineMs = 0,
    getOffSessionCharge = jest.fn().mockResolvedValue(null)
  }: {
    findOffSessionCharge?: jest.Mock;
    deadlineMs?: number;
    getOffSessionCharge?: jest.Mock;
  } = {}
): Promise<{
  service: RenewalService;
  emit: jest.Mock;
  charge: jest.Mock;
  findCharge: jest.Mock;
  getCharge: jest.Mock;
}> {
  const emit = jest.fn();
  const manager = makeManager(store);
  const dataSource = {
    transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
    manager
  };
  const provider = {
    id: 'yookassa' as BillingProviderId,
    managesLifecycle: false,
    startCheckout: jest.fn(),
    chargeOffSession,
    findOffSessionCharge,
    getOffSessionCharge,
    createOneTimePayment: jest.fn(),
    changePlan: jest.fn(),
    previewChangePlan: jest.fn(),
    updatePaymentMethod: jest.fn(),
    cancel: jest.fn(),
    refund: jest.fn(),
    verifyAndParseWebhook: jest.fn()
  } satisfies PaymentProvider;

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
      {
        provide: BILLING_PROVIDERS,
        useValue: [withProviderDeadline(provider, deadlineMs)]
      },
      { provide: EventEmitter2, useValue: { emit } }
    ]
  }).compile();

  return {
    service: moduleRef.get(RenewalService),
    emit,
    charge: chargeOffSession,
    findCharge: findOffSessionCharge,
    getCharge: getOffSessionCharge
  };
}

/** The row an earlier attempt recorded under the key of the due period. */
function priorInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return Object.assign(new Invoice(), {
    id: 'inv-pre',
    providerEventId: `renewal:sub-1:${new Date('2026-06-01T00:00:00Z').getTime()}`,
    status: 'failed',
    providerInvoiceRef: '',
    amountMinor: Money.fromMinor(99000),
    ...overrides
  });
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
      {
        amountMinor: 99000,
        currency: 'RUB',
        receiptItems: [
          {
            description: 'Pro',
            amountMinor: 99000,
            quantity: 1,
            paymentMode: 'full_payment'
          }
        ],
        idempotencyKey:
          'renewal:sub-1:' + new Date('2026-06-01T00:00:00Z').getTime()
      }
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

  it.each([
    ['captured', 'paid'],
    ['pending', 'pending'],
    ['declined', 'failed']
  ] as const)(
    'charges and books a %s renewal in the currency of the price, not the locale currency of the customer',
    async (outcome, status) => {
      const sub = makeSub();
      const store = baseStore(sub);

      // A non-Russian locale that chose the region "Russia".
      Object.assign(store.customers[0], {
        country: 'US',
        currency: 'USD',
        providerOverride: 'yookassa'
      });
      const charge = jest.fn(
        (..._args: Parameters<PaymentProvider['chargeOffSession']>) =>
          outcome === 'declined'
            ? Promise.reject(new Error('declined'))
            : Promise.resolve({ providerInvoiceRef: 'pay_1', status: outcome })
      );
      const { service } = await build(store, charge);

      await service.runDueRenewals(NOW);

      expect(charge).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD' }),
        {
          amountMinor: 99000,
          currency: 'RUB',
          receiptItems: expect.any(Array),
          idempotencyKey: expect.any(String)
        }
      );
      expect(store.invoices).toHaveLength(1);
      expect(store.invoices[0]).toMatchObject({ status, currency: 'RUB' });
    }
  );

  it('bounds a stalled provider call and still renews the next due subscription', async () => {
    const stalled = makeSub();
    const next = makeSub({ id: 'sub-2', customerId: 'cust-2' });
    const store = baseStore(stalled);

    store.subscriptions.push(next);
    store.customers.push(
      Object.assign(makeCustomer(), { id: 'cust-2', userId: 'user-2' })
    );
    // Without a deadline the first charge never settles and the scan never
    // reaches `sub-2` — the whole queue waits on one stuck socket.
    const charge = jest.fn((customer: Customer) =>
      customer.id === 'cust-1'
        ? new Promise<never>(() => {})
        : Promise.resolve({ providerInvoiceRef: 'pay_2', status: 'captured' })
    );
    const { service } = await build(store, charge, {
      deadlineMs: 20
    });

    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(2);
    expect(next.status).toBe('active');
    expect(next.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(store.invoices).toHaveLength(2);
    expect(store.invoices[1]).toMatchObject({ providerInvoiceRef: 'pay_2' });
    // The timed-out charge takes the ordinary decline path: one dunning rung,
    // and its period is booked unpaid, so a payment the deadline hid from us
    // has a row for its confirming webhook to write the reference onto.
    expect(store.invoices[0]).toMatchObject({
      subscriptionId: 'sub-1',
      status: 'failed',
      providerInvoiceRef: ''
    });
    expect(stalled.status).toBe('past_due');
    expect(stalled.dunningAttempts).toBe(1);
  });

  it('processes at most one run worth of due subscriptions and drains the rest on the next scan', async () => {
    const total = RENEWAL_SCAN_MAX_PER_RUN + 5;
    const subs = Array.from({ length: total }, (_, i) =>
      makeSub({ id: `sub-${i + 1}` })
    );
    const store = baseStore(subs[0]);

    store.subscriptions = subs;
    const charge = jest
      .fn()
      .mockResolvedValue({ providerInvoiceRef: 'pay', status: 'captured' });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(RENEWAL_SCAN_MAX_PER_RUN);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('per-run ceiling')
    );
    const overflow = subs.slice(RENEWAL_SCAN_MAX_PER_RUN);

    overflow.forEach((s) => {
      expect(s.currentPeriodEnd).toEqual(new Date('2026-06-01T00:00:00Z'));
    });

    // The scan takes the oldest due first, so the next one picks up exactly the
    // remainder: the advanced rows are no longer due and cost nothing.
    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(total);
    expect(store.invoices).toHaveLength(total);
    subs.forEach((s) => {
      expect(s.status).toBe('active');
      expect(s.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
    });

    warn.mockRestore();
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
    // The trial's own start is not the billing day - the first paid period is.
    expect(sub.billingAnchorAt).toEqual(new Date('2026-06-05T00:00:00Z'));
  });

  describe('month-end billing day', () => {
    /**
     * Renews `sub` once per period and returns the boundary each renewal set.
     * Every scan runs at the boundary that fell due, as the scheduler does.
     */
    async function renewalDays(
      sub: Subscription,
      periods: number
    ): Promise<string[]> {
      const store = baseStore(sub);
      const charge = jest
        .fn()
        .mockResolvedValue({ providerInvoiceRef: 'pay', status: 'captured' });
      const { service } = await build(store, charge);
      const ends: string[] = [];

      for (let i = 0; i < periods; i++) {
        await service.runDueRenewals(sub.currentPeriodEnd);
        ends.push(sub.currentPeriodEnd.toISOString());
      }

      return ends;
    }

    it('returns to the 31st after February instead of ratcheting to the 28th', async () => {
      const sub = makeSub({
        currentPeriodStart: new Date('2025-12-31T10:00:00Z'),
        currentPeriodEnd: new Date('2026-01-31T10:00:00Z'),
        billingAnchorAt: new Date('2025-12-31T10:00:00Z')
      });

      // Chaining each boundary onto the previous one gives
      // 02-28 -> 03-28 -> 04-28 -> 05-28 -> 06-28: one short month moved the
      // customer to the 28th permanently.
      expect(await renewalDays(sub, 5)).toEqual([
        '2026-02-28T10:00:00.000Z',
        '2026-03-31T10:00:00.000Z',
        '2026-04-30T10:00:00.000Z',
        '2026-05-31T10:00:00.000Z',
        '2026-06-30T10:00:00.000Z'
      ]);
    });

    it('keeps the invoice period aligned with the subscription period', async () => {
      const sub = makeSub({
        currentPeriodStart: new Date('2025-12-31T10:00:00Z'),
        currentPeriodEnd: new Date('2026-01-31T10:00:00Z'),
        billingAnchorAt: new Date('2025-12-31T10:00:00Z')
      });
      const store = baseStore(sub);
      const charge = jest
        .fn()
        .mockResolvedValue({ providerInvoiceRef: 'pay', status: 'captured' });
      const { service } = await build(store, charge);

      await service.runDueRenewals(sub.currentPeriodEnd);
      const firstEnd = sub.currentPeriodEnd;

      await service.runDueRenewals(sub.currentPeriodEnd);

      expect(store.invoices).toHaveLength(2);
      expect(store.invoices[0]).toMatchObject({
        periodStart: new Date('2026-01-31T10:00:00Z'),
        periodEnd: firstEnd
      });
      expect(store.invoices[1]).toMatchObject({
        periodStart: firstEnd,
        periodEnd: sub.currentPeriodEnd
      });
    });

    it('leaves a mid-month billing day untouched', async () => {
      const sub = makeSub({
        currentPeriodStart: new Date('2026-04-15T10:00:00Z'),
        currentPeriodEnd: new Date('2026-05-15T10:00:00Z'),
        billingAnchorAt: new Date('2026-04-15T10:00:00Z')
      });

      expect(await renewalDays(sub, 3)).toEqual([
        '2026-06-15T10:00:00.000Z',
        '2026-07-15T10:00:00.000Z',
        '2026-08-15T10:00:00.000Z'
      ]);
    });

    it('falls back to the period start for a row written before the anchor existed', async () => {
      const sub = makeSub({
        currentPeriodStart: new Date('2025-12-31T10:00:00Z'),
        currentPeriodEnd: new Date('2026-01-31T10:00:00Z'),
        billingAnchorAt: null
      });

      expect(await renewalDays(sub, 2)).toEqual([
        '2026-02-28T10:00:00.000Z',
        '2026-03-31T10:00:00.000Z'
      ]);
      expect(sub.billingAnchorAt).toEqual(new Date('2025-12-31T10:00:00Z'));
    });
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
      const keys = charge.mock.calls.map(
        (call: [unknown, { idempotencyKey?: string }]) => call[1].idempotencyKey
      );

      expect(keys[0]).toEqual(expect.any(String));
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

      store.invoices.push(priorInvoice());
      const charge = jest.fn();
      const findCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_prior',
        status: 'captured'
      });
      const { service, emit } = await build(store, charge, {
        findOffSessionCharge: findCharge
      });

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

      store.invoices.push(priorInvoice());
      const charge = jest.fn();
      const findCharge = jest.fn().mockRejectedValue(new Error('api down'));
      const { service, emit } = await build(store, charge, {
        findOffSessionCharge: findCharge
      });

      await service.runDueRenewals(NOW);

      expect(charge).not.toHaveBeenCalled();
      expect(store.invoices).toEqual([
        expect.objectContaining({ status: 'failed' })
      ]);
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
      const { service } = await build(store, charge, {
        findOffSessionCharge: findCharge
      });

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

  it('leaves a due subscription to the plan change that holds its lease', async () => {
    const sub = makeSub({
      planChangeStartedAt: new Date(NOW.getTime() - PLAN_CHANGE_LEASE_MS + 1)
    });
    const store = baseStore(sub);
    const charge = jest.fn();
    const { service } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).not.toHaveBeenCalled();
    expect(store.invoices).toHaveLength(0);
  });

  it('renews a due subscription whose plan change lease expired', async () => {
    const sub = makeSub({
      planChangeStartedAt: new Date(NOW.getTime() - PLAN_CHANGE_LEASE_MS)
    });
    const store = baseStore(sub);
    const charge = jest
      .fn()
      .mockResolvedValue({ providerInvoiceRef: 'pay-1', status: 'captured' });
    const { service } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).toHaveBeenCalledTimes(1);
    expect(store.subscriptions[0].currentPeriodStart).toEqual(
      new Date('2026-06-01T00:00:00Z')
    );
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
    expect(store.invoices).toHaveLength(1);
    expect(store.invoices[0]).toMatchObject({
      providerEventId: `renewal:sub-1:${new Date('2026-06-01T00:00:00Z').getTime()}`,
      status: 'failed',
      providerInvoiceRef: ''
    });
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

  it('advances the dunning ladder one rung when two scans react to one decline', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    // The first scan records the period and waits inside the provider. The
    // second finds that row, sees no charge at the provider, and fails it;
    // then the first charge declines too. Both scans read the row at dunning
    // rung 0, so only the CAS keeps the second rung from being consumed.
    const { promise: charged, resolve: charging } =
      Promise.withResolvers<void>();
    const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
    const charge = jest.fn(() => {
      charging();

      return gate.then<never>(() => Promise.reject(new Error('declined')));
    });
    const { service, emit } = await build(store, charge);

    const first = service.runDueRenewals(NOW);

    await charged;
    await service.runDueRenewals(NOW);
    openGate();
    await first;

    expect(charge).toHaveBeenCalledTimes(1);
    expect(sub.status).toBe('past_due');
    expect(sub.dunningAttempts).toBe(1);
    expect(
      emit.mock.calls.filter(
        (call: unknown[]) => call[0] === PaymentFailedEvent.name
      )
    ).toHaveLength(1);
    expect(
      emit.mock.calls.filter(
        (call: unknown[]) => call[0] === SubscriptionPastDueEvent.name
      )
    ).toHaveLength(1);
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

  it('cancels once at the boundary when two scans reach it together', async () => {
    const sub = makeSub({ cancelAtPeriodEnd: true });
    const store = baseStore(sub);
    const charge = jest.fn();
    const { service, emit } = await build(store, charge);

    // Both scans load the still-active row, so only the guarded write may
    // cancel it; the loser must not re-cancel or notify a second time.
    await Promise.all([
      service.runDueRenewals(NOW),
      service.runDueRenewals(NOW)
    ]);

    expect(charge).not.toHaveBeenCalled();
    expect(sub.status).toBe('canceled');
    expect(
      emit.mock.calls.filter(
        (call: unknown[]) => call[0] === SubscriptionCanceledEvent.name
      )
    ).toHaveLength(1);
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

  it('does not resurrect a subscription canceled while the charge was in flight', async () => {
    const sub = makeSub();
    const store = baseStore(sub);
    // The cancel commits during the provider round-trip; it leaves
    // currentPeriodEnd untouched, so only the status guard can stop the advance.
    const charge = jest.fn().mockImplementation(() => {
      sub.status = 'canceled';

      return Promise.resolve({
        providerInvoiceRef: 'pay_1',
        status: 'captured'
      });
    });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(sub.status).toBe('canceled');
    expect(sub.currentPeriodStart).toEqual(new Date('2026-05-01T00:00:00Z'));
    expect(sub.currentPeriodEnd).toEqual(new Date('2026-06-01T00:00:00Z'));
    // The money moved, so the paid invoice stays on the books (refundable).
    expect(store.invoices).toHaveLength(1);
    expect(store.invoices[0]).toMatchObject({
      status: 'paid',
      amountMinor: Money.fromMinor(99000)
    });
    expect(emit).toHaveBeenCalledWith(
      InvoicePaidEvent.name,
      expect.objectContaining({ userId: 'user-1' })
    );
    expect(
      emit.mock.calls.filter(
        (call: unknown[]) => call[0] === SubscriptionRenewedEvent.name
      )
    ).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('captured after it became canceled')
    );
    warn.mockRestore();
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
      providerInvoiceRef: 'pay_wh'
    };

    store.invoices.push(preInvoice);
    const charge = jest.fn();
    const { service, emit } = await build(store, charge);

    await service.runDueRenewals(NOW);

    expect(charge).not.toHaveBeenCalled();
    expect(store.invoices).toHaveLength(1);
    expect(sub.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
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
      const { service, emit } = await build(store, pendingCharge());

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
      expect(emit).not.toHaveBeenCalled();
    });

    it('settles the pending invoice and advances when the poll finds it captured', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const getCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_pend',
        status: 'captured'
      });
      const findCharge = jest.fn();
      const { service, emit, charge } = await build(store, pendingCharge(), {
        findOffSessionCharge: findCharge,
        deadlineMs: 0,
        getOffSessionCharge: getCharge
      });

      await service.runDueRenewals(NOW);
      await service.runDueRenewals(NOW);

      // The recorded reference answers the poll directly: no shop-wide scan.
      expect(getCharge).toHaveBeenCalledWith(
        'pay_pend',
        'renewal:sub-1:' + new Date('2026-06-01T00:00:00Z').getTime()
      );
      expect(findCharge).not.toHaveBeenCalled();
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
      const getCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_pend',
        status: 'pending'
      });
      const { service, emit, charge } = await build(store, pendingCharge(), {
        deadlineMs: 0,
        getOffSessionCharge: getCharge
      });

      await service.runDueRenewals(NOW);
      await service.runDueRenewals(NOW);

      expect(charge).toHaveBeenCalledTimes(1);
      expect(store.invoices[0]).toMatchObject({ status: 'pending' });
      expect(sub.currentPeriodEnd).toEqual(new Date('2026-06-01T00:00:00Z'));
      expect(emit).not.toHaveBeenCalled();
    });

    it('scans for the charge when the pending row carries no provider reference', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const anchorMs = new Date('2026-06-01T00:00:00Z').getTime();

      store.invoices.push(priorInvoice({ status: 'pending' }));
      const findCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_scan',
        status: 'pending'
      });
      const getCharge = jest.fn();
      const { service, charge } = await build(store, jest.fn(), {
        findOffSessionCharge: findCharge,
        deadlineMs: 0,
        getOffSessionCharge: getCharge
      });

      await service.runDueRenewals(NOW);

      expect(getCharge).not.toHaveBeenCalled();
      expect(findCharge).toHaveBeenCalledWith(
        `renewal:sub-1:${anchorMs}`,
        new Date('2026-06-01T00:00:00Z')
      );
      expect(charge).not.toHaveBeenCalled();
    });

    it('skips the cycle without failing the invoice when the poll itself errors', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const getCharge = jest
        .fn()
        .mockRejectedValue(new Error('payment lookup down'));
      const { service, emit } = await build(store, pendingCharge(), {
        deadlineMs: 0,
        getOffSessionCharge: getCharge
      });

      await service.runDueRenewals(NOW);
      await service.runDueRenewals(NOW);

      // An unreadable payment is an unknown outcome, not a decline: the row
      // stays pending and dunning is untouched so no second charge is posted.
      expect(store.invoices[0]).toMatchObject({ status: 'pending' });
      expect(sub.status).toBe('active');
      expect(sub.dunningAttempts).toBe(0);
      expect(emit).not.toHaveBeenCalled();
    });

    it('fails the invoice and enters dunning when the pending charge cancels at capture', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const getCharge = jest.fn().mockResolvedValue(null);
      const { service, emit } = await build(store, pendingCharge(), {
        deadlineMs: 0,
        getOffSessionCharge: getCharge
      });

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
        providerInvoiceRef: 'pay_pend'
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

    it('records a pending prior attempt found by the dunning reconcile and waits', async () => {
      const sub = makeSub({
        status: 'past_due',
        dunningAttempts: 1,
        nextRenewalAttemptAt: new Date('2026-06-07T00:00:00Z')
      });
      const store = baseStore(sub);

      store.invoices.push(priorInvoice());
      const charge = jest.fn();
      const findCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_prior',
        status: 'pending'
      });
      const { service, emit } = await build(store, charge, {
        findOffSessionCharge: findCharge
      });

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

  describe('a period that re-rates to zero while a charge is open', () => {
    it('keeps a pending fixed charge when the plan is re-priced to zero', async () => {
      const sub = makeSub();
      const store = baseStore(sub);
      const charge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_fix',
        status: 'pending'
      });
      const getCharge = jest.fn().mockResolvedValue({
        providerInvoiceRef: 'pay_fix',
        status: 'pending'
      });
      const { service } = await build(store, charge, {
        deadlineMs: 0,
        getOffSessionCharge: getCharge
      });

      await service.runDueRenewals(NOW);
      expect(store.invoices[0]).toMatchObject({
        status: 'pending',
        amountMinor: Money.fromMinor(99000)
      });

      store.plans[0].prices = { yookassa: { currency: 'RUB', amountMinor: 0 } };
      await service.runDueRenewals(NOW);

      expect(getCharge).toHaveBeenCalledTimes(1);
      expect(store.invoices).toHaveLength(1);
      expect(store.invoices[0]).toMatchObject({
        status: 'pending',
        amountMinor: Money.fromMinor(99000),
        providerInvoiceRef: 'pay_fix'
      });
      expect(sub.currentPeriodEnd).toEqual(new Date('2026-06-01T00:00:00Z'));
    });
  });
});
