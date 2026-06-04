// End-to-end coverage for the Paddle billing webhook path: an injected
// (verified) webhook flows through the public receiver → WebhookIngestionService
// (idempotency ledger) → BillingEventReducer, reducing onto the in-memory
// Subscription/Invoice stores and emitting the matching domain event. Proves the
// checkout→active transition a real Paddle `subscription.activated` drives, plus
// replay idempotency — without a running PostgreSQL or real Paddle.

import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { VersioningType, type INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import type { Server } from 'http';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import type {
  NormalizedEvent,
  PaymentProvider
} from '../src/modules/billing/providers/payment-provider.interface';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { WebhookIngestionService } from '../src/modules/billing/webhooks/webhook-ingestion.service';
import { BillingWebhooksController } from '../src/modules/billing/webhooks/billing-webhooks.controller';
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
      return Promise.resolve(null);
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
