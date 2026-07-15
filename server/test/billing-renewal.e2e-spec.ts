// End-to-end coverage for the self-managed (YooKassa) renewal scheduler: a due
// subscription is swept by RenewalService, charged off-session through the
// provider seam, advanced (or walked down the dunning ladder), and the resulting
// billing domain event flows through the REAL EventEmitter2 bus into the
// entitlement-cache listener — proving the emitted event names match what the
// listener subscribes to. Runs without PostgreSQL, Redis, or real YooKassa.

import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { BillingProviderId } from '@app/shared/types';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { DUNNING_MAX_ATTEMPTS } from '../src/modules/billing/renewals/renewal-queue.constants';
import { EntitlementCacheListener } from '../src/modules/billing/listeners/entitlement-cache.listener';
import { EntitlementService } from '../src/modules/billing/entitlements/entitlement.service';
import { CreditService } from '../src/modules/billing/services/credit.service';

interface StoredInvoice {
  [column: string]: unknown;
  id: string;
  providerEventId: string | null;
  status?: string;
  providerInvoiceRef?: string;
  creditUnitsApplied?: number;
}

interface Store {
  subscriptions: Subscription[];
  customers: Customer[];
  plans: Plan[];
  invoices: StoredInvoice[];
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
      where: Record<string, unknown>,
      set: Record<string, unknown>
    ) => {
      if (entity === Subscription) {
        // The period advance compare-and-swaps on the period end read at scan
        // start, so the criterion carries a Date.
        const matches = store.subscriptions.filter(
          (s) =>
            s.id === where['id'] &&
            (where['currentPeriodEnd'] === undefined ||
              s.currentPeriodEnd.getTime() ===
                (where['currentPeriodEnd'] as Date).getTime())
        );
        for (const s of matches) Object.assign(s, set);
        return Promise.resolve({ affected: matches.length });
      }
      if (entity === Invoice) {
        const matches = store.invoices.filter((i) =>
          Object.entries(where).every(([k, v]) => i[k] === v)
        );
        for (const i of matches) Object.assign(i, set);
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
          if (
            store.invoices.some(
              (i) => i.providerEventId === v['providerEventId']
            )
          ) {
            return Promise.resolve({ raw: [] });
          }
          const id = `inv-${++seq}`;
          store.invoices.push({
            id,
            providerEventId: (v['providerEventId'] as string) ?? null,
            status: v['status'] as string,
            providerInvoiceRef: v['providerInvoiceRef'] as string,
            creditUnitsApplied: (v['creditUnitsApplied'] as number) ?? 0
          });
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
        innerJoin: () => qb,
        where: () => qb,
        andWhere: () => qb,
        setParameters: () => qb,
        orderBy: () => qb,
        getMany: () =>
          Promise.resolve(
            store.subscriptions.filter(
              (s) =>
                s.lifecycleOwner === 'self' &&
                ['trialing', 'active', 'past_due'].includes(s.status)
            )
          )
      };
      return qb;
    }
  };
}

describe('Billing renewal scheduler (e2e)', () => {
  let app: INestApplication;
  let service: RenewalService;
  let store: Store;
  let invalidateUser: jest.Mock;
  let chargeOffSession: jest.Mock;
  let usageSum: jest.Mock;

  beforeEach(async () => {
    store = {
      subscriptions: [],
      customers: [
        Object.assign(new Customer(), {
          id: 'cust-1',
          userId: 'user-1',
          currency: 'RUB'
        })
      ],
      plans: [
        Object.assign(new Plan(), {
          key: 'pro',
          name: 'Pro',
          billingMode: 'fixed',
          interval: 'month',
          prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
        }),
        Object.assign(new Plan(), {
          key: 'usage',
          name: 'Pay as you go',
          billingMode: 'usage',
          interval: 'month',
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
      ],
      invoices: []
    };
    invalidateUser = jest.fn().mockResolvedValue(undefined);
    chargeOffSession = jest
      .fn()
      .mockResolvedValue({ providerInvoiceRef: 'pay_1', status: 'captured' });
    usageSum = jest.fn().mockResolvedValue(null);

    const manager = makeManager(store);
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        RenewalService,
        FixedRating,
        UsageRating,
        {
          // UsageRating aggregates via a raw bigint SUM query; drive the same
          // `usageSum` knob through the query-builder's getRawOne wire shape.
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
        EntitlementCacheListener,
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
        {
          provide: getDataSourceToken(),
          useValue: {
            transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
            manager
          }
        },
        {
          provide: BILLING_PROVIDERS,
          useValue: [
            {
              id: 'yookassa',
              managesLifecycle: false,
              ensureCustomer: jest.fn(),
              startCheckout: jest.fn(),
              chargeOffSession,
              findOffSessionCharge: jest.fn().mockResolvedValue(null),
              cancel: jest.fn(),
              refund: jest.fn(),
              verifyAndParseWebhook: jest.fn()
            }
          ]
        },
        { provide: EntitlementService, useValue: { invalidateUser } },
        // No prepaid credits in this scenario set — the credits-as-usage flow
        // has its own coverage in billing-webhook.e2e-spec and the unit specs.
        {
          provide: CreditService,
          useValue: {
            availableUnits: jest.fn().mockResolvedValue(0),
            spendOnUsage: jest.fn()
          }
        }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(RenewalService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('renews a due subscription and invalidates entitlements via the event bus', async () => {
    store.subscriptions.push(makeSub());

    await service.runDueRenewals(NOW);

    expect(chargeOffSession).toHaveBeenCalledTimes(1);
    expect(store.invoices).toHaveLength(1);
    expect(store.subscriptions[0].status).toBe('active');
    expect(store.subscriptions[0].currentPeriodEnd).toEqual(
      new Date('2026-07-01T00:00:00Z')
    );
    // The renewed event reached the entitlement-cache listener over the real bus.
    expect(invalidateUser).toHaveBeenCalledWith('user-1');
  });

  it('closes a usage period postpaid: charges the overage and advances', async () => {
    usageSum.mockResolvedValue(142);
    store.subscriptions.push(
      makeSub({ planKey: 'usage', billingMode: 'usage' })
    );

    await service.runDueRenewals(NOW);

    expect(chargeOffSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cust-1' }),
      8400,
      [
        {
          description: 'Pay as you go: api_calls × 42',
          amountMinor: 8400,
          quantity: 1
        }
      ],
      expect.stringMatching(/^renewal:sub-1:/)
    );
    expect(store.invoices).toHaveLength(1);
    expect(store.subscriptions[0].currentPeriodEnd).toEqual(
      new Date('2026-07-01T00:00:00Z')
    );
    expect(invalidateUser).toHaveBeenCalledWith('user-1');
  });

  it('cancels after dunning is exhausted and invalidates entitlements', async () => {
    chargeOffSession.mockRejectedValue(new Error('declined'));
    store.subscriptions.push(
      makeSub({
        status: 'past_due',
        dunningAttempts: DUNNING_MAX_ATTEMPTS - 1,
        nextRenewalAttemptAt: new Date('2026-06-07T00:00:00Z')
      })
    );

    await service.runDueRenewals(NOW);

    expect(store.subscriptions[0].status).toBe('canceled');
    expect(invalidateUser).toHaveBeenCalledWith('user-1');
  });
});
