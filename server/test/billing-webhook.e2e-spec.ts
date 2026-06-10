// End-to-end coverage for the Paddle billing webhook path: an injected
// (verified) webhook flows through the public receiver → WebhookIngestionService
// (idempotency ledger) → BillingEventReducer, reducing onto the in-memory
// Subscription/Invoice stores and emitting the matching domain event. Proves the
// checkout→active transition a real Paddle `subscription.activated` drives, plus
// replay idempotency — without a running PostgreSQL or real Paddle.

import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { VersioningType, type INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import type { Server } from 'http';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
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
import { SubscriptionActivatedEvent } from '../src/modules/billing/events/billing.events';

// ── In-memory stores + EntityManager / DataSource stand-ins ─────────────────

interface Stores {
  subscriptions: Subscription[];
  invoices: Invoice[];
  customers: Customer[];
  plans: Plan[];
  webhookEvents: Array<{ id: string; providerEventId: string }>;
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
    create: (_entity: unknown, data: object) => ({ ...data }) as Subscription,
    save: (entity: Subscription) => {
      if (!entity.id) {
        entity.id = `sub-${++seq}`;
        stores.subscriptions.push(entity);
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

function makeWebhookEventRepo(stores: Stores) {
  let seq = 0;
  return {
    createQueryBuilder: () => {
      const captured: { values?: { providerEventId: string } } = {};
      const builder = {
        insert: () => builder,
        values: (v: { providerEventId: string }) => {
          captured.values = v;
          return builder;
        },
        orIgnore: () => builder,
        returning: () => builder,
        execute: () => {
          const v = captured.values!;
          const dup = stores.webhookEvents.some(
            (e) => e.providerEventId === v.providerEventId
          );
          if (dup) return Promise.resolve({ raw: [] });
          const id = `wh-${++seq}`;
          stores.webhookEvents.push({ id, providerEventId: v.providerEventId });
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    },
    update: jest.fn().mockResolvedValue({ affected: 1 })
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
    chargeUsage: jest.fn(),
    changePlan: jest.fn(),
    previewChangePlan: jest.fn(),
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

  beforeEach(async () => {
    stores = {
      subscriptions: [],
      invoices: [],
      customers: [{ id: 'cust-1', userId: 'user-1' } as Customer],
      plans: [{ key: 'pro', billingMode: 'fixed' } as Plan],
      webhookEvents: []
    };
    emit = jest.fn();
    const manager = makeManager(stores);
    const dataSource = {
      transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
      manager
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingWebhooksController],
      providers: [
        WebhookIngestionService,
        BillingEventReducer,
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: makeWebhookEventRepo(stores)
        },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: EventEmitter2, useValue: { emit } },
        { provide: BILLING_PROVIDERS, useValue: [makeStubProvider()] }
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

  it('rejects a webhook the provider cannot verify', async () => {
    await request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: null }))
      .expect(400);

    expect(stores.subscriptions).toHaveLength(0);
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
        {
          provide: getRepositoryToken(UsageRecord),
          useValue: { sum: jest.fn().mockResolvedValue(142) }
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
      amountMinor: 84,
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
