// Cross-path coverage: the YooKassa renewal scheduler charges + records the
// invoice, then the confirming payment.succeeded webhook flows through the real
// YooKassaProvider + BillingEventReducer. Proves the webhook reconciles onto the
// scheduler's invoice instead of inserting a duplicate / re-activating.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { YooCheckout } from '@a2seven/yoo-checkout';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { User } from '../src/modules/users/entities/user.entity';
import {
  InvoicePaidEvent,
  SubscriptionActivatedEvent
} from '../src/modules/billing/events/billing.events';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { YooKassaProvider } from '../src/modules/billing/providers/yookassa.provider';
import { YOOKASSA_CLIENT } from '../src/modules/billing/providers/yookassa.client';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';

const NOW = new Date('2026-06-08T00:00:00Z');

interface Store {
  subscriptions: Subscription[];
  customers: Customer[];
  plans: Plan[];
  invoices: Invoice[];
  paymentMethods: PaymentMethod[];
}

function findWhere<T extends object>(rows: T[], where: Partial<T>): T | null {
  return (
    rows.find((row) =>
      Object.entries(where).every(
        ([k, v]) => (row as Record<string, unknown>)[k] === v
      )
    ) ?? null
  );
}

function makeManager(store: Store) {
  let seq = 0;
  return {
    findOne: (entity: unknown, opts: { where: Record<string, unknown> }) => {
      if (entity === Subscription)
        return Promise.resolve(findWhere(store.subscriptions, opts.where));
      if (entity === Customer)
        return Promise.resolve(findWhere(store.customers, opts.where));
      if (entity === Plan)
        return Promise.resolve(findWhere(store.plans, opts.where));
      if (entity === Invoice)
        return Promise.resolve(findWhere(store.invoices, opts.where));
      return Promise.resolve(null);
    },
    update: (
      entity: unknown,
      where: Record<string, unknown>,
      set: Record<string, unknown>
    ) => {
      const rows: object[] =
        entity === Invoice ? store.invoices : store.paymentMethods;
      const matches = rows.filter((row) =>
        Object.entries(where).every(
          ([k, v]) => (row as Record<string, unknown>)[k] === v
        )
      );
      for (const row of matches) Object.assign(row, set);
      return Promise.resolve({ affected: matches.length });
    },
    save: (entity: { id?: string }) => Promise.resolve(entity),
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
          store.invoices.push(Object.assign(new Invoice(), { id }, v));
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    }
  };
}

describe('YooKassa off-session charge reconcile (e2e)', () => {
  let store: Store;
  let renewals: RenewalService;
  let reducer: BillingEventReducer;
  let provider: YooKassaProvider;
  let emit: jest.Mock;
  let createPayment: jest.Mock;
  let capturedMetadata: Record<string, unknown> | undefined;

  beforeEach(async () => {
    store = {
      subscriptions: [
        Object.assign(new Subscription(), {
          id: 'sub-1',
          customerId: 'cust-1',
          planKey: 'pro',
          provider: 'yookassa',
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
          nextRenewalAttemptAt: null
        })
      ],
      customers: [
        Object.assign(new Customer(), {
          id: 'cust-1',
          userId: 'user-1',
          currency: 'RUB',
          defaultPaymentMethodId: 'pm-1'
        })
      ],
      plans: [
        Object.assign(new Plan(), {
          key: 'pro',
          name: 'Pro',
          billingMode: 'fixed',
          interval: 'month',
          prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
        })
      ],
      invoices: [],
      paymentMethods: [
        Object.assign(new PaymentMethod(), {
          id: 'pm-1',
          customerId: 'cust-1',
          provider: 'yookassa',
          providerMethodRef: 'tok-1',
          brand: 'Visa',
          last4: '4242',
          isDefault: true
        })
      ]
    };

    capturedMetadata = undefined;
    createPayment = jest.fn(
      (payload: { metadata?: Record<string, unknown> }) => {
        capturedMetadata = payload.metadata;
        return Promise.resolve({ id: 'pay-1', status: 'succeeded' });
      }
    );
    const getPayment = jest.fn(() =>
      Promise.resolve({
        id: 'pay-1',
        status: 'succeeded',
        amount: { value: '990.00', currency: 'RUB' },
        captured_at: '2026-06-08T00:01:00Z',
        metadata: capturedMetadata
      })
    );
    const yoo = { createPayment, getPayment } as unknown as YooCheckout;
    emit = jest.fn();
    const manager = makeManager(store);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RenewalService,
        BillingEventReducer,
        YooKassaProvider,
        FixedRating,
        UsageRating,
        { provide: YOOKASSA_CLIENT, useValue: yoo },
        { provide: ConfigService, useValue: { get: () => '1' } },
        { provide: EventEmitter2, useValue: { emit } },
        {
          provide: CreditService,
          useValue: {
            availableUnits: () => Promise.resolve(0),
            spendOnUsage: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(UsageRecord),
          useValue: { sum: () => Promise.resolve(0) }
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: () => Promise.resolve({ email: 'u@example.com' })
          }
        },
        {
          provide: getRepositoryToken(PaymentMethod),
          useValue: {
            findOne: (opts: { where: { id: string } }) =>
              Promise.resolve(
                store.paymentMethods.find((m) => m.id === opts.where.id) ?? null
              )
          }
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
          provide: getRepositoryToken(Subscription),
          useValue: {
            findOne: (opts: { where: { id: string } }) =>
              Promise.resolve(
                store.subscriptions.find((s) => s.id === opts.where.id) ?? null
              ),
            createQueryBuilder: () => {
              const qb = {
                where: () => qb,
                andWhere: () => qb,
                setParameters: () => qb,
                orderBy: () => qb,
                getMany: () =>
                  Promise.resolve(
                    store.subscriptions.filter(
                      (s) =>
                        s.lifecycleOwner === 'self' && s.currentPeriodEnd <= NOW
                    )
                  )
              };
              return qb;
            }
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
          useFactory: (p: YooKassaProvider) => [p],
          inject: [YooKassaProvider]
        }
      ]
    }).compile();

    renewals = moduleRef.get(RenewalService);
    reducer = moduleRef.get(BillingEventReducer);
    provider = moduleRef.get(YooKassaProvider);
  });

  it('records one invoice for a renewal whose payment.succeeded webhook is also delivered', async () => {
    await renewals.runDueRenewals(NOW);

    // Scheduler charged once and stamped the off-session marker carrying the
    // invoice key, so the confirming webhook is recognizable.
    expect(createPayment).toHaveBeenCalledTimes(1);
    const renewalKey = `renewal:sub-1:${new Date('2026-06-01T00:00:00Z').getTime()}:0`;
    expect(capturedMetadata).toMatchObject({
      purpose: 'off_session',
      chargeKey: renewalKey
    });
    expect(store.invoices).toHaveLength(1);
    expect(store.invoices[0].providerEventId).toBe(renewalKey);

    const event = await provider.verifyAndParseWebhook(
      Buffer.from(
        JSON.stringify({ event: 'payment.succeeded', object: { id: 'pay-1' } })
      )
    );
    await reducer.reduce(event!);

    // The webhook reconciled onto the scheduler's invoice: no duplicate row, no
    // second default card, and no spurious activation on a renewal.
    expect(store.invoices).toHaveLength(1);
    expect(store.invoices[0].providerInvoiceRef).toBe('pay-1');
    expect(store.paymentMethods.filter((m) => m.isDefault)).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(2);
    const events = emit.mock.calls.map((c: unknown[]) => c[0]);
    expect(events).toContain(InvoicePaidEvent.name);
    expect(events).not.toContain(SubscriptionActivatedEvent.name);
  });
});
