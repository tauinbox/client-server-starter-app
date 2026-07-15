// End-to-end coverage for the Paddle billing webhook path: an injected
// (verified) webhook flows through the public receiver → WebhookIngestionService
// (idempotency ledger) → BillingEventReducer, reducing onto the in-memory
// Subscription/Invoice stores and emitting the matching domain event. Proves the
// checkout→active transition a real Paddle `subscription.activated` drives, plus
// replay idempotency — without a running PostgreSQL or real Paddle.

import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { VersioningType, type INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import type { Server } from 'http';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { EntitlementService } from '../src/modules/billing/entitlements/entitlement.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { CreditBalance } from '../src/modules/billing/entities/credit-balance.entity';
import { CreditLedger } from '../src/modules/billing/entities/credit-ledger.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { CustomerGrant } from '../src/modules/billing/entities/customer-grant.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { Money } from '@app/shared/utils/money';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import type {
  NormalizedEvent,
  PaymentProvider
} from '../src/modules/billing/providers/payment-provider.interface';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { WebhookIngestionService } from '../src/modules/billing/webhooks/webhook-ingestion.service';
import { BillingWebhooksController } from '../src/modules/billing/webhooks/billing-webhooks.controller';
import { UsageInvoicingService } from '../src/modules/billing/services/usage-invoicing.service';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import {
  InvoicePaidEvent,
  SubscriptionActivatedEvent
} from '../src/modules/billing/events/billing.events';

// ── In-memory stores + EntityManager / DataSource stand-ins ─────────────────

interface Stores {
  subscriptions: Subscription[];
  invoices: Invoice[];
  customers: Customer[];
  plans: Plan[];
  products: Product[];
  grants: CustomerGrant[];
  creditBalances: CreditBalance[];
  creditLedger: CreditLedger[];
  webhookEvents: Array<{
    id: string;
    provider: string;
    providerEventId: string;
    status: string;
    payload: NormalizedEvent;
  }>;
}

function findWhere<T extends object>(rows: T[], where: Partial<T>): T | null {
  return (
    rows.find((row) =>
      Object.entries(where).every(
        ([key, value]) => row[key as keyof T] === value
      )
    ) ?? null
  );
}

function makeManager(stores: Stores) {
  let seq = 0;
  return {
    findOne: (entity: unknown, opts: { where: Record<string, unknown> }) => {
      if (entity === Subscription)
        return Promise.resolve(findWhere(stores.subscriptions, opts.where));
      if (entity === Plan)
        return Promise.resolve(findWhere(stores.plans, opts.where));
      if (entity === Customer)
        return Promise.resolve(findWhere(stores.customers, opts.where));
      if (entity === Invoice)
        return Promise.resolve(findWhere(stores.invoices, opts.where));
      if (entity === Product)
        return Promise.resolve(findWhere(stores.products, opts.where));
      if (entity === CreditBalance)
        return Promise.resolve(findWhere(stores.creditBalances, opts.where));
      return Promise.resolve(null);
    },
    update: (
      entity: unknown,
      where: Record<string, unknown>,
      set: Record<string, unknown>
    ) => {
      if (entity !== Invoice) return Promise.resolve({ affected: 0 });
      const matches = stores.invoices.filter((row) =>
        Object.entries(where).every(
          ([key, value]) => row[key as keyof Invoice] === value
        )
      );
      for (const row of matches) Object.assign(row, set);
      return Promise.resolve({ affected: matches.length });
    },
    create: (entity: { prototype: object }, data: object) =>
      Object.assign(Object.create(entity.prototype) as object, data),
    save: (entity: { id?: string }) => {
      if (!entity.id) {
        if (entity instanceof CustomerGrant) {
          entity.id = `grant-${++seq}`;
          stores.grants.push(entity);
        } else if (entity instanceof CreditLedger) {
          entity.id = `ledger-${++seq}`;
          stores.creditLedger.push(entity);
        } else {
          entity.id = `sub-${++seq}`;
          stores.subscriptions.push(entity as Subscription);
        }
      }
      return Promise.resolve(entity);
    },
    // Stands in for CreditService's balance upsert (the only raw SQL in the
    // billing reduce path): params are [customerId, delta].
    query: (_sql: string, params: [string, number]) => {
      const [customerId, delta] = params;
      const balance = stores.creditBalances.find(
        (b) => b.customerId === customerId
      );
      if (balance) {
        balance.balanceUnits = balance.balanceUnits.add(Money.fromMinor(delta));
      } else {
        stores.creditBalances.push({
          customerId,
          balanceUnits: Money.fromMinor(delta),
          updatedAt: new Date()
        } as CreditBalance);
      }
      return Promise.resolve(undefined);
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
            (i) => i.providerEventId === v['providerEventId']
          );
          if (dup) return Promise.resolve({ raw: [] });
          const id = `inv-${++seq}`;
          stores.invoices.push({ id, ...v } as unknown as Invoice);
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    }
  };
}

// Stateful stand-in for the WebhookEvent repo: the (provider, provider_event_id)
// unique key gates the insert, and `update` flips the row's status so the
// status-aware dedup (skip only when `processed`) can be exercised end to end.
function makeWebhookEventRepo(stores: Stores) {
  let seq = 0;
  return {
    createQueryBuilder: () => {
      const captured: {
        values?: {
          provider: string;
          providerEventId: string;
          status: string;
          payload: NormalizedEvent;
        };
      } = {};
      const builder = {
        insert: () => builder,
        values: (v: {
          provider: string;
          providerEventId: string;
          status: string;
          payload: NormalizedEvent;
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
    findOne: (opts: { where: Record<string, unknown> }) =>
      Promise.resolve(findWhere(stores.webhookEvents, opts.where)),
    update: (where: { id: string }, set: Record<string, unknown>) => {
      const matches = stores.webhookEvents.filter((e) => e.id === where.id);
      for (const row of matches) Object.assign(row, set);
      return Promise.resolve({ affected: matches.length });
    }
  };
}

// Stub provider: turns the posted body into a verified NormalizedEvent, the way
// the real PaddleProvider would after webhooks.unmarshal succeeds.
function makeStubProvider(): PaymentProvider {
  return {
    id: 'paddle',
    managesLifecycle: true,
    ensureCustomer: jest.fn(),
    startCheckout: jest.fn(),
    chargeOffSession: jest.fn(),
    findOffSessionCharge: jest.fn(),
    createOneTimePayment: jest.fn(),
    chargeUsage: jest.fn(),
    changePlan: jest.fn(),
    previewChangePlan: jest.fn(),
    updatePaymentMethod: jest.fn(),
    cancel: jest.fn(),
    refund: jest.fn(),
    verifyAndParseWebhook: (rawBody: Buffer) => {
      const parsed = JSON.parse(rawBody.toString('utf8')) as {
        event: NormalizedEvent | null;
      };
      return Promise.resolve(parsed.event);
    }
  } as PaymentProvider;
}

describe('Billing Paddle webhook (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let stores: Stores;
  let emit: jest.Mock;
  let entitlements: EntitlementService;
  let reducer: BillingEventReducer;

  beforeEach(async () => {
    stores = {
      subscriptions: [],
      invoices: [],
      customers: [{ id: 'cust-1', userId: 'user-1' } as Customer],
      plans: [{ key: 'pro', billingMode: 'fixed' } as Plan],
      products: [
        {
          id: 'prod-sku',
          key: 'report-pack',
          type: 'sku',
          grant: { entitlement: 'reports' }
        } as Product,
        {
          id: 'prod-don',
          key: 'donation',
          type: 'custom',
          grant: null
        } as Product,
        {
          id: 'prod-cr',
          key: 'credits-500',
          type: 'credits',
          grant: { credits: 500 }
        } as Product
      ],
      grants: [],
      creditBalances: [],
      creditLedger: [],
      webhookEvents: []
    };
    emit = jest.fn();
    const manager = makeManager(stores);
    const dataSource = {
      transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
      manager
    };

    // EntitlementService over the same stores: proves a paid sku purchase
    // resolves into an active capability (the grant union), end to end.
    const cacheStore = new Map<string, unknown>();
    const moduleRef = await Test.createTestingModule({
      controllers: [BillingWebhooksController],
      providers: [
        WebhookIngestionService,
        BillingEventReducer,
        EntitlementService,
        CreditService,
        // WebhookIpAllowlistGuard dep; unset allowlist keeps the receivers open
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: getRepositoryToken(CreditBalance),
          useValue: {
            findOne: (opts: { where: Partial<CreditBalance> }) =>
              Promise.resolve(findWhere(stores.creditBalances, opts.where))
          }
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: makeWebhookEventRepo(stores)
        },
        {
          provide: getRepositoryToken(Customer),
          useValue: {
            findOne: (opts: { where: Partial<Customer> }) =>
              Promise.resolve(findWhere(stores.customers, opts.where))
          }
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: { findOne: () => Promise.resolve(null) }
        },
        {
          provide: getRepositoryToken(Plan),
          useValue: {
            findOne: (opts: { where: Partial<Plan> }) =>
              Promise.resolve(findWhere(stores.plans, opts.where))
          }
        },
        {
          provide: getRepositoryToken(CustomerGrant),
          useValue: {
            find: (opts: { where: { customerId: string } }) =>
              Promise.resolve(
                stores.grants.filter(
                  (grant) =>
                    grant.customerId === opts.where.customerId &&
                    grant.revokedAt === null
                )
              )
          }
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: (key: string) => Promise.resolve(cacheStore.get(key)),
            set: (key: string, value: unknown) => {
              cacheStore.set(key, value);
              return Promise.resolve();
            },
            del: (key: string) => {
              cacheStore.delete(key);
              return Promise.resolve();
            }
          }
        },
        { provide: MetricsService, useValue: { recordCacheAccess: jest.fn() } },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: EventEmitter2, useValue: { emit } },
        { provide: BILLING_PROVIDERS, useValue: [makeStubProvider()] }
      ]
    }).compile();
    entitlements = moduleRef.get(EntitlementService);
    reducer = moduleRef.get(BillingEventReducer);

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  const activationEvent: NormalizedEvent = {
    provider: 'paddle',
    providerEventId: 'evt_activate_1',
    type: 'subscription.activated',
    payload: {
      ref: { customerId: 'cust-1', userId: 'user-1' },
      providerSubscriptionId: 'sub_paddle_1',
      status: 'active',
      planKey: 'pro',
      currentPeriodStart: '2026-06-01T00:00:00Z',
      currentPeriodEnd: '2026-07-01T00:00:00Z',
      cancelAtPeriodEnd: false,
      trialEnd: null
    }
  };

  it('activates a subscription from an injected Paddle webhook', async () => {
    await request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('paddle-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: activationEvent }))
      .expect(200)
      .expect({ received: true });

    expect(stores.subscriptions).toHaveLength(1);
    expect(stores.subscriptions[0]).toMatchObject({
      planKey: 'pro',
      provider: 'paddle',
      status: 'active',
      lifecycleOwner: 'provider',
      providerSubscriptionId: 'sub_paddle_1'
    });
    expect(emit).toHaveBeenCalledWith(
      SubscriptionActivatedEvent.name,
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('no-ops a replayed webhook (idempotent on provider_event_id)', async () => {
    const post = () =>
      request(server)
        .post('/api/v1/billing/webhooks/paddle')
        .set('paddle-signature', 'sig')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event: activationEvent }))
        .expect(200);

    await post();
    await post();

    expect(stores.subscriptions).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('reprocesses a delivery whose first reduce failed, applying it exactly once', async () => {
    // First reduce throws: the idempotency row is committed `received` but
    // nothing is applied, and the controller surfaces a 500 so the provider
    // redelivers. The second reduce runs the real reducer.
    const realReduce = reducer.reduce.bind(reducer);
    const reduceSpy = jest
      .spyOn(reducer, 'reduce')
      .mockRejectedValueOnce(new Error('transient reduce failure'))
      .mockImplementation((event) => realReduce(event));

    const post = () =>
      request(server)
        .post('/api/v1/billing/webhooks/paddle')
        .set('paddle-signature', 'sig')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event: activationEvent }));

    await post().expect(500);
    expect(stores.subscriptions).toHaveLength(0);
    expect(stores.webhookEvents).toHaveLength(1);
    expect(stores.webhookEvents[0].status).toBe('received');

    // Redelivery of the same event id: the still-`received` row is reprocessed
    // (not deduped on existence), so the subscription is applied exactly once.
    await post().expect(200);
    expect(stores.subscriptions).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(stores.webhookEvents).toHaveLength(1);
    expect(stores.webhookEvents[0].status).toBe('processed');

    reduceSpy.mockRestore();
  });

  it('rejects a webhook the provider cannot verify', async () => {
    await request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: null }))
      .expect(400);

    expect(stores.subscriptions).toHaveLength(0);
  });

  // ── One-time purchases ──────────────────────────────────────────────────────

  const oneTimePaid = (
    providerEventId: string,
    productId: string
  ): NormalizedEvent => ({
    provider: 'paddle',
    providerEventId,
    type: 'invoice.paid',
    payload: {
      ref: { customerId: 'cust-1', userId: 'user-1' },
      providerInvoiceRef: 'txn_ot_1',
      providerSubscriptionId: null,
      amountMinor: 4900,
      currency: 'USD',
      periodStart: null,
      periodEnd: null,
      paidAt: '2026-06-11T10:00:00Z',
      kind: 'one_time',
      productId
    }
  });

  function postWebhook(event: NormalizedEvent) {
    return request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('paddle-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event }))
      .expect(200);
  }

  it('reduces a paid one-time sku purchase onto a one_time invoice and grants the entitlement', async () => {
    await postWebhook(oneTimePaid('evt_ot_1', 'prod-sku'));

    expect(stores.invoices).toHaveLength(1);
    expect(stores.invoices[0]).toMatchObject({
      kind: 'one_time',
      productId: 'prod-sku',
      subscriptionId: null,
      status: 'paid',
      amountMinor: Money.fromMinor(4900)
    });
    expect(stores.grants).toHaveLength(1);
    expect(stores.grants[0]).toMatchObject({
      customerId: 'cust-1',
      entitlement: 'reports',
      sourceInvoiceId: stores.invoices[0].id,
      expiresAt: null,
      revokedAt: null
    });
    expect(stores.subscriptions).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith(
      InvoicePaidEvent.name,
      expect.objectContaining({ userId: 'user-1' })
    );
    expect(emit).not.toHaveBeenCalledWith(
      SubscriptionActivatedEvent.name,
      expect.anything()
    );
  });

  it('resolves the granted entitlement as active for the buyer (capability union)', async () => {
    const before = await entitlements.capabilitiesFor('user-1');
    expect(before.capabilities).not.toContain('reports');
    await entitlements.invalidateUser('user-1');

    await postWebhook(oneTimePaid('evt_ot_1', 'prod-sku'));

    const after = await entitlements.capabilitiesFor('user-1');
    expect(after.capabilities).toContain('reports');
  });

  it('replays the one-time paid webhook without duplicating the invoice or the grant', async () => {
    await postWebhook(oneTimePaid('evt_ot_1', 'prod-sku'));
    await postWebhook(oneTimePaid('evt_ot_1', 'prod-sku'));

    expect(stores.invoices).toHaveLength(1);
    expect(stores.grants).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('records a paid custom (donation) purchase without any grant', async () => {
    await postWebhook(oneTimePaid('evt_ot_don', 'prod-don'));

    expect(stores.invoices).toHaveLength(1);
    expect(stores.invoices[0]).toMatchObject({
      kind: 'one_time',
      productId: 'prod-don',
      subscriptionId: null,
      status: 'paid'
    });
    expect(stores.grants).toHaveLength(0);
  });

  it('tops up the prepaid balance from a paid credit-pack purchase', async () => {
    await postWebhook(oneTimePaid('evt_ot_cr', 'prod-cr'));

    expect(stores.invoices).toHaveLength(1);
    expect(stores.invoices[0]).toMatchObject({
      kind: 'one_time',
      productId: 'prod-cr',
      status: 'paid'
    });
    expect(stores.creditBalances).toEqual([
      expect.objectContaining({
        customerId: 'cust-1',
        balanceUnits: Money.fromMinor(500)
      })
    ]);
    expect(stores.creditLedger).toEqual([
      expect.objectContaining({
        customerId: 'cust-1',
        delta: Money.fromMinor(500),
        reason: 'purchase',
        refInvoiceId: stores.invoices[0].id
      })
    ]);
    // A credit pack writes no entitlement grant.
    expect(stores.grants).toHaveLength(0);
  });

  it('replays the credit-pack webhook without topping up twice', async () => {
    await postWebhook(oneTimePaid('evt_ot_cr', 'prod-cr'));
    await postWebhook(oneTimePaid('evt_ot_cr', 'prod-cr'));

    expect(stores.invoices).toHaveLength(1);
    expect(stores.creditBalances[0].balanceUnits).toEqual(Money.fromMinor(500));
    expect(stores.creditLedger).toHaveLength(1);
  });
});

// ── Paddle usage invoicing flow (real event bus) ────────────────────────────
// A renewal webhook rolls the usage subscription's period → the reducer emits
// UsagePeriodClosed over the REAL EventEmitter2 bus → UsageInvoicingService
// plants a pending invoice and posts the one-time charge → the charge's
// transaction.completed webhook settles that invoice by its usage charge key.

describe('Billing Paddle usage invoicing (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let stores: Stores;
  let chargeUsage: jest.Mock;

  const CLOSED_END = new Date('2026-06-01T00:00:00Z');
  const CHARGE_KEY = `usage:sub-1:${CLOSED_END.getTime()}`;

  function invoicesRepo() {
    let seq = 100;
    return {
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
              (i) => i.providerEventId === v['providerEventId']
            );
            if (dup) return Promise.resolve({ raw: [] });
            const id = `inv-${++seq}`;
            stores.invoices.push({ id, ...v } as unknown as Invoice);
            return Promise.resolve({ raw: [{ id }] });
          }
        };
        return builder;
      }
    };
  }

  beforeEach(async () => {
    stores = {
      subscriptions: [
        {
          id: 'sub-1',
          customerId: 'cust-1',
          planKey: 'usage',
          provider: 'paddle',
          billingMode: 'usage',
          status: 'active',
          lifecycleOwner: 'provider',
          currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
          currentPeriodEnd: CLOSED_END,
          cancelAtPeriodEnd: false,
          trialEnd: null,
          providerSubscriptionId: 'sub_paddle_1'
        } as Subscription
      ],
      invoices: [],
      customers: [
        { id: 'cust-1', userId: 'user-1', currency: 'USD' } as Customer
      ],
      plans: [
        {
          key: 'usage',
          name: 'Pay as you go',
          billingMode: 'usage',
          meterKey: 'api_calls',
          prices: {
            paddle: {
              currency: 'USD',
              amountMinor: 0,
              unitPriceMinor: 2,
              includedUnits: 100
            }
          }
        } as Plan
      ],
      products: [],
      grants: [],
      creditBalances: [],
      creditLedger: [],
      webhookEvents: []
    };
    chargeUsage = jest.fn().mockResolvedValue(undefined);
    const manager = makeManager(stores);
    const dataSource = {
      transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
      manager
    };
    const provider = {
      ...makeStubProvider(),
      chargeUsage
    } as PaymentProvider;

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      controllers: [BillingWebhooksController],
      providers: [
        WebhookIngestionService,
        BillingEventReducer,
        UsageInvoicingService,
        UsageRating,
        CreditService,
        // WebhookIpAllowlistGuard dep; unset allowlist keeps the receivers open
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: getRepositoryToken(CreditBalance),
          useValue: {
            findOne: (opts: { where: Partial<CreditBalance> }) =>
              Promise.resolve(findWhere(stores.creditBalances, opts.where))
          }
        },
        {
          provide: getRepositoryToken(UsageRecord),
          useValue: {
            createQueryBuilder: () => {
              const qb = {
                select: () => qb,
                where: () => qb,
                andWhere: () => qb,
                getRawOne: () => Promise.resolve({ total: '142' })
              };
              return qb;
            }
          }
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: makeWebhookEventRepo(stores)
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: {
            findOne: (opts: { where: Record<string, unknown> }) =>
              Promise.resolve(findWhere(stores.subscriptions, opts.where))
          }
        },
        {
          provide: getRepositoryToken(Customer),
          useValue: {
            findOne: (opts: { where: Record<string, unknown> }) =>
              Promise.resolve(findWhere(stores.customers, opts.where))
          }
        },
        {
          provide: getRepositoryToken(Plan),
          useValue: {
            findOne: (opts: { where: Record<string, unknown> }) =>
              Promise.resolve(findWhere(stores.plans, opts.where))
          }
        },
        { provide: getRepositoryToken(Invoice), useValue: invoicesRepo() },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: BILLING_PROVIDERS, useValue: [provider] }
      ]
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  const renewalEvent: NormalizedEvent = {
    provider: 'paddle',
    providerEventId: 'evt_renew_1',
    type: 'subscription.renewed',
    payload: {
      ref: { customerId: 'cust-1', userId: 'user-1' },
      providerSubscriptionId: 'sub_paddle_1',
      status: 'active',
      planKey: 'usage',
      currentPeriodStart: '2026-06-01T00:00:00Z',
      currentPeriodEnd: '2026-07-01T00:00:00Z',
      cancelAtPeriodEnd: false,
      trialEnd: null
    }
  };

  function postWebhook(event: NormalizedEvent) {
    return request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('paddle-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event }))
      .expect(200);
  }

  /** The OnEvent handler runs detached from the request; let it settle. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('rolls the period, plants a pending invoice, charges, and settles it from the paid webhook', async () => {
    await postWebhook(renewalEvent);
    await settle();

    // 142 units − 100 included = 42 × $0.02 = 84 minor units.
    expect(chargeUsage).toHaveBeenCalledWith(
      'sub_paddle_1',
      84,
      'USD',
      'Pay as you go: api_calls × 42',
      CHARGE_KEY
    );
    expect(stores.invoices).toHaveLength(1);
    expect(stores.invoices[0]).toMatchObject({
      providerEventId: CHARGE_KEY,
      amountMinor: Money.fromMinor(84),
      status: 'pending',
      billingMode: 'usage',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: CLOSED_END
    });
    expect(stores.subscriptions[0].currentPeriodEnd).toEqual(
      new Date('2026-07-01T00:00:00Z')
    );

    await postWebhook({
      provider: 'paddle',
      providerEventId: 'evt_txn_1',
      type: 'invoice.paid',
      payload: {
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerInvoiceRef: 'txn_usage_1',
        providerSubscriptionId: 'sub_paddle_1',
        amountMinor: 84,
        currency: 'USD',
        periodStart: null,
        periodEnd: null,
        paidAt: '2026-06-01T00:05:00Z',
        usageChargeKey: CHARGE_KEY
      }
    });

    expect(stores.invoices).toHaveLength(1);
    expect(stores.invoices[0]).toMatchObject({
      status: 'paid',
      providerInvoiceRef: 'txn_usage_1'
    });
  });

  it('spends prepaid credits before charging and charges only the remainder', async () => {
    stores.creditBalances.push({
      customerId: 'cust-1',
      balanceUnits: Money.fromMinor(10),
      updatedAt: new Date()
    } as CreditBalance);

    await postWebhook(renewalEvent);
    await settle();

    // 42 billable − 10 credits = 32 × $0.02 = 64 minor units.
    expect(chargeUsage).toHaveBeenCalledWith(
      'sub_paddle_1',
      64,
      'USD',
      'Pay as you go: api_calls × 32',
      CHARGE_KEY
    );
    expect(stores.invoices[0]).toMatchObject({
      amountMinor: Money.fromMinor(64),
      status: 'pending'
    });
    expect(stores.creditBalances[0].balanceUnits).toEqual(Money.fromMinor(0));
    expect(stores.creditLedger).toEqual([
      expect.objectContaining({
        customerId: 'cust-1',
        delta: Money.fromMinor(-10),
        reason: 'usage',
        refInvoiceId: stores.invoices[0].id
      })
    ]);
  });

  it('records a fully credit-covered period as paid at zero without a charge', async () => {
    stores.creditBalances.push({
      customerId: 'cust-1',
      balanceUnits: Money.fromMinor(1000),
      updatedAt: new Date()
    } as CreditBalance);

    await postWebhook(renewalEvent);
    await settle();

    expect(chargeUsage).not.toHaveBeenCalled();
    expect(stores.invoices[0]).toMatchObject({
      amountMinor: Money.fromMinor(0),
      status: 'paid'
    });
    expect(stores.creditBalances[0].balanceUnits).toEqual(Money.fromMinor(958));
  });

  it('never double-charges a replayed renewal rollover', async () => {
    await postWebhook(renewalEvent);
    await settle();
    // A second delivery with a NEW event id but the same (already applied)
    // period snapshot: the stored period no longer advances, nothing fires.
    await postWebhook({
      ...renewalEvent,
      providerEventId: 'evt_renew_dup'
    });
    await settle();

    expect(chargeUsage).toHaveBeenCalledTimes(1);
    expect(stores.invoices).toHaveLength(1);
  });

  it('marks the pending invoice failed when the usage charge is declined', async () => {
    await postWebhook(renewalEvent);
    await settle();

    await postWebhook({
      provider: 'paddle',
      providerEventId: 'evt_fail_1',
      type: 'payment.failed',
      payload: {
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerSubscriptionId: 'sub_paddle_1',
        usageChargeKey: CHARGE_KEY
      }
    });

    expect(stores.invoices[0]).toMatchObject({ status: 'failed' });
  });
});
