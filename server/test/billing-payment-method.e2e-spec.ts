// End-to-end coverage for the payment-method update flow:
// a YooKassa method-update re-bind webhook flows through the public receiver →
// WebhookIngestionService → the REAL YooKassaProvider (re-fetch by id against a
// mocked client) → BillingEventReducer, which swaps the customer's default
// PaymentMethod without writing an invoice or touching the subscription status.
// The renewal scheduler then charges off-session through the same real provider
// and the mocked client receives the NEW saved token — proving the replaced
// method is the one used by the next renewal. Replays are idempotent. Runs
// without PostgreSQL, Redis, or real YooKassa.

import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { VersioningType, type INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import type { Server } from 'http';
import type { ICreatePayment } from '@a2seven/yoo-checkout';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import { YooKassaProvider } from '../src/modules/billing/providers/yookassa.provider';
import { YOOKASSA_CLIENT } from '../src/modules/billing/providers/yookassa.client';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { WebhookIngestionService } from '../src/modules/billing/webhooks/webhook-ingestion.service';
import { BillingWebhooksController } from '../src/modules/billing/webhooks/billing-webhooks.controller';

// ── In-memory stores + EntityManager / DataSource / repo stand-ins ──────────

interface Stores {
  customers: Customer[];
  subscriptions: Subscription[];
  paymentMethods: PaymentMethod[];
  invoices: Array<Record<string, unknown> & { id: string }>;
  plans: Plan[];
  webhookEvents: Array<{
    id: string;
    provider: string;
    providerEventId: string;
    status: string;
    payload: object;
  }>;
}

const NOW = new Date('2026-06-08T00:00:00Z');

function makeStores(): Stores {
  return {
    customers: [
      Object.assign(new Customer(), {
        id: 'cust-1',
        userId: 'user-1',
        provider: 'yookassa',
        providerOverride: null,
        country: 'RU',
        currency: 'RUB',
        providerCustomerId: null,
        defaultPaymentMethodId: 'pm-old'
      })
    ],
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
        paymentMethodId: 'pm-old',
        dunningAttempts: 0,
        nextRenewalAttemptAt: null,
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-01T00:00:00Z')
      })
    ],
    paymentMethods: [
      Object.assign(new PaymentMethod(), {
        id: 'pm-old',
        customerId: 'cust-1',
        provider: 'yookassa',
        providerMethodRef: 'tok-old',
        brand: 'Visa',
        last4: '4242',
        isDefault: true
      })
    ],
    invoices: [],
    plans: [
      Object.assign(new Plan(), {
        key: 'pro',
        name: 'Pro',
        billingMode: 'fixed',
        interval: 'month',
        trialDays: 0,
        prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
      })
    ],
    webhookEvents: []
  };
}

function makeManager(stores: Stores) {
  let methodSeq = 0;
  let invoiceSeq = 0;
  return {
    findOne: (entity: unknown, opts: { where: Record<string, unknown> }) => {
      const where = opts.where;
      if (entity === Subscription) {
        if (typeof where['id'] === 'string') {
          return Promise.resolve(
            stores.subscriptions.find((s) => s.id === where['id']) ?? null
          );
        }
        // The reducer looks the open subscription up by customer id with an
        // In(...) status filter — the store keeps one non-canceled row.
        return Promise.resolve(
          stores.subscriptions.find(
            (s) =>
              s.customerId === where['customerId'] && s.status !== 'canceled'
          ) ?? null
        );
      }
      if (entity === Customer) {
        return Promise.resolve(
          stores.customers.find((c) => c.id === where['id']) ?? null
        );
      }
      if (entity === Plan) {
        return Promise.resolve(
          stores.plans.find((p) => p.key === where['key']) ?? null
        );
      }
      return Promise.resolve(null);
    },
    update: (
      entity: unknown,
      where: Record<string, unknown>,
      set: Record<string, unknown>
    ) => {
      if (entity === PaymentMethod) {
        const matches = stores.paymentMethods.filter(
          (m) =>
            m.customerId === where['customerId'] &&
            m.isDefault === where['isDefault']
        );
        for (const m of matches) Object.assign(m, set);
        return Promise.resolve({ affected: matches.length });
      }
      if (entity === Customer) {
        const matches = stores.customers.filter((c) => c.id === where['id']);
        for (const c of matches) Object.assign(c, set);
        return Promise.resolve({ affected: matches.length });
      }
      if (entity === Subscription) {
        // The period advance is a compare-and-swap on the period end read at
        // scan start, so the criterion carries a Date.
        const matches = stores.subscriptions.filter(
          (s) =>
            s.id === where['id'] &&
            (where['currentPeriodEnd'] === undefined ||
              s.currentPeriodEnd.getTime() ===
                (where['currentPeriodEnd'] as Date).getTime())
        );
        for (const s of matches) Object.assign(s, set);
        return Promise.resolve({ affected: matches.length });
      }
      return Promise.resolve({ affected: 0 });
    },
    create: (_entity: unknown, data: object) => ({ ...data }),
    save: (entity: Record<string, unknown>) => {
      if ('providerMethodRef' in entity) {
        if (!entity['id']) {
          entity['id'] = `pm-new-${++methodSeq}`;
          stores.paymentMethods.push(entity as unknown as PaymentMethod);
        }
      }
      return Promise.resolve(entity);
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
          const dup = stores.invoices.some(
            (i) => i['providerEventId'] === v['providerEventId']
          );
          if (dup) return Promise.resolve({ raw: [] });
          const id = `inv-${++invoiceSeq}`;
          stores.invoices.push({ id, ...v });
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    }
  };
}

function makeWebhookEventRepo(stores: Stores) {
  let seq = 0;
  return {
    createQueryBuilder: () => {
      const captured: {
        values?: {
          provider: string;
          providerEventId: string;
          status: string;
          payload: object;
        };
      } = {};
      const builder = {
        insert: () => builder,
        values: (v: {
          provider: string;
          providerEventId: string;
          status: string;
          payload: object;
        }) => {
          captured.values = v;
          return builder;
        },
        orIgnore: () => builder,
        returning: () => builder,
        execute: () => {
          const v = captured.values!;
          const dup = stores.webhookEvents.some(
            (e) =>
              e.provider === v.provider &&
              e.providerEventId === v.providerEventId
          );
          if (dup) return Promise.resolve({ raw: [] });
          const id = `wh-${++seq}`;
          stores.webhookEvents.push({
            id,
            provider: v.provider,
            providerEventId: v.providerEventId,
            status: v.status,
            payload: v.payload
          });
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    },
    findOne: (opts: { where: { provider: string; providerEventId: string } }) =>
      Promise.resolve(
        stores.webhookEvents.find(
          (e) =>
            e.provider === opts.where.provider &&
            e.providerEventId === opts.where.providerEventId
        ) ?? null
      ),
    update: (where: { id: string }, set: Record<string, unknown>) => {
      const matches = stores.webhookEvents.filter((e) => e.id === where.id);
      for (const row of matches) Object.assign(row, set);
      return Promise.resolve({ affected: matches.length });
    }
  };
}

function subscriptionsRepo(stores: Stores) {
  return {
    findOne: (opts: { where: { id: string } }) =>
      Promise.resolve(
        stores.subscriptions.find((s) => s.id === opts.where.id) ?? null
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
            stores.subscriptions.filter(
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

describe('Billing payment-method update flow (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let stores: Stores;
  let renewals: RenewalService;
  let getPayment: jest.Mock;
  let createPayment: jest.Mock;

  beforeEach(async () => {
    stores = makeStores();
    getPayment = jest.fn();
    createPayment = jest.fn();
    const manager = makeManager(stores);
    const dataSource = {
      transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
      manager
    };

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      controllers: [BillingWebhooksController],
      providers: [
        WebhookIngestionService,
        BillingEventReducer,
        RenewalService,
        FixedRating,
        UsageRating,
        // No prepaid credits in this scenario set — the credits flow has its
        // own coverage in billing-webhook.e2e-spec and the unit specs.
        {
          provide: CreditService,
          useValue: {
            availableUnits: jest.fn().mockResolvedValue(0),
            spendOnUsage: jest.fn(),
            addPurchase: jest.fn()
          }
        },
        YooKassaProvider,
        { provide: YOOKASSA_CLIENT, useValue: { getPayment, createPayment } },
        {
          provide: ConfigService,
          useValue: { get: () => undefined }
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn().mockResolvedValue({ email: 'buyer@example.com' })
          }
        },
        {
          provide: getRepositoryToken(PaymentMethod),
          useValue: {
            findOne: (opts: { where: { id: string } }) =>
              Promise.resolve(
                stores.paymentMethods.find((m) => m.id === opts.where.id) ??
                  null
              )
          }
        },
        {
          provide: getRepositoryToken(UsageRecord),
          useValue: { sum: jest.fn().mockResolvedValue(null) }
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: makeWebhookEventRepo(stores)
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: subscriptionsRepo(stores)
        },
        {
          provide: getRepositoryToken(Customer),
          useValue: {
            findOne: (opts: { where: { id: string } }) =>
              Promise.resolve(
                stores.customers.find((c) => c.id === opts.where.id) ?? null
              )
          }
        },
        {
          provide: getRepositoryToken(Plan),
          useValue: {
            findOne: (opts: { where: { key: string } }) =>
              Promise.resolve(
                stores.plans.find((p) => p.key === opts.where.key) ?? null
              )
          }
        },
        { provide: getDataSourceToken(), useValue: dataSource },
        {
          provide: BILLING_PROVIDERS,
          useFactory: (yoo: YooKassaProvider) => [yoo],
          inject: [YooKassaProvider]
        }
      ]
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    server = app.getHttpServer() as Server;
    renewals = app.get(RenewalService);
  });

  afterEach(async () => {
    await app.close();
  });

  const methodUpdatePayment = {
    id: 'pay-mu',
    status: 'succeeded',
    amount: { value: '0.00', currency: 'RUB' },
    payment_method: {
      id: 'tok-new',
      saved: true,
      card: { card_type: 'MasterCard', last4: '4444' }
    },
    metadata: {
      customerId: 'cust-1',
      userId: 'user-1',
      purpose: 'method_update'
    }
  };

  function postMethodUpdateWebhook() {
    return request(server)
      .post('/api/v1/billing/webhooks/yookassa')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          type: 'notification',
          event: 'payment.succeeded',
          object: { id: 'pay-mu' }
        })
      )
      .expect(200)
      .expect({ received: true });
  }

  it('replaces the default method from the re-bind webhook and charges the next renewal on it', async () => {
    getPayment.mockResolvedValue(methodUpdatePayment);

    await postMethodUpdateWebhook();

    // The new card became the default; the old one is demoted, not deleted.
    const oldMethod = stores.paymentMethods.find((m) => m.id === 'pm-old')!;
    const newMethod = stores.paymentMethods.find((m) => m.id !== 'pm-old')!;
    expect(getPayment).toHaveBeenCalledWith('pay-mu');
    expect(oldMethod.isDefault).toBe(false);
    expect(newMethod).toMatchObject({
      providerMethodRef: 'tok-new',
      brand: 'MasterCard',
      last4: '4444',
      isDefault: true
    });
    expect(stores.customers[0].defaultPaymentMethodId).toBe(newMethod.id);
    expect(stores.subscriptions[0].paymentMethodId).toBe(newMethod.id);
    // No money moved: no invoice row, subscription status untouched.
    expect(stores.invoices).toHaveLength(0);
    expect(stores.subscriptions[0].status).toBe('active');

    // The due renewal now autopays with the NEW saved token.
    createPayment.mockResolvedValue({ id: 'pay-renew', status: 'succeeded' });
    await renewals.runDueRenewals(NOW);

    expect(createPayment).toHaveBeenCalledTimes(1);
    const [chargePayload] = createPayment.mock.calls[0] as [ICreatePayment];
    expect(chargePayload.payment_method_id).toBe('tok-new');
    expect(stores.invoices).toHaveLength(1);
    expect(stores.subscriptions[0].currentPeriodEnd).toEqual(
      new Date('2026-07-01T00:00:00Z')
    );
  });

  it('no-ops a replayed method-update webhook (idempotent on provider_event_id)', async () => {
    getPayment.mockResolvedValue(methodUpdatePayment);

    await postMethodUpdateWebhook();
    await postMethodUpdateWebhook();

    expect(stores.paymentMethods).toHaveLength(2);
    expect(stores.paymentMethods.filter((m) => m.isDefault)).toHaveLength(1);
  });
});
