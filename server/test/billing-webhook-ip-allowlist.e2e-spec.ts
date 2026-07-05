// A non-allowlisted IP must be rejected BEFORE provider verification runs:
// for YooKassa that verification is an outbound API re-fetch an attacker
// could otherwise force at will (the receivers also skip the throttle).
// X-Forwarded-For may only be honored per the `trust proxy` setting.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import type { Server } from 'http';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import type {
  NormalizedEvent,
  PaymentProvider
} from '../src/modules/billing/providers/payment-provider.interface';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { WebhookIngestionService } from '../src/modules/billing/webhooks/webhook-ingestion.service';
import { WebhookIpAllowlistGuard } from '../src/modules/billing/webhooks/webhook-ip-allowlist.guard';
import { BillingWebhooksController } from '../src/modules/billing/webhooks/billing-webhooks.controller';

function makeEvent(id: string): NormalizedEvent {
  return {
    provider: 'paddle',
    providerEventId: id,
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
}

function makeWebhookEventRepo() {
  const rows: Array<{ id: string; provider: string; providerEventId: string }> =
    [];
  let seq = 0;
  return {
    createQueryBuilder: () => {
      const captured: {
        values?: { provider: string; providerEventId: string };
      } = {};
      const builder = {
        insert: () => builder,
        values: (v: { provider: string; providerEventId: string }) => {
          captured.values = v;
          return builder;
        },
        orIgnore: () => builder,
        returning: () => builder,
        execute: () => {
          const v = captured.values!;
          const dup = rows.some(
            (e) =>
              e.provider === v.provider &&
              e.providerEventId === v.providerEventId
          );
          if (dup) return Promise.resolve({ raw: [] });
          const id = `wh-${++seq}`;
          rows.push({ id, ...v });
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    },
    findOne: () => Promise.resolve(null),
    update: () => Promise.resolve({ affected: 1 })
  };
}

async function makeApp(options: {
  allowlist: string;
  trustProxy?: string;
}): Promise<{
  app: NestExpressApplication;
  server: Server;
  verifySpy: jest.Mock;
}> {
  const verifySpy = jest.fn((rawBody: Buffer) => {
    const parsed = JSON.parse(rawBody.toString('utf8')) as {
      event: NormalizedEvent;
    };
    return Promise.resolve(parsed.event);
  });
  const provider = {
    id: 'paddle',
    managesLifecycle: true,
    ensureCustomer: jest.fn(),
    startCheckout: jest.fn(),
    chargeOffSession: jest.fn(),
    createOneTimePayment: jest.fn(),
    chargeUsage: jest.fn(),
    changePlan: jest.fn(),
    previewChangePlan: jest.fn(),
    updatePaymentMethod: jest.fn(),
    cancel: jest.fn(),
    refund: jest.fn(),
    verifyAndParseWebhook: verifySpy
  } as PaymentProvider;

  const moduleRef = await Test.createTestingModule({
    controllers: [BillingWebhooksController],
    providers: [
      WebhookIngestionService,
      WebhookIpAllowlistGuard,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            key === 'BILLING_WEBHOOK_IP_ALLOWLIST'
              ? options.allowlist
              : undefined
        }
      },
      {
        provide: getRepositoryToken(WebhookEvent),
        useValue: makeWebhookEventRepo()
      },
      { provide: BillingEventReducer, useValue: { reduce: jest.fn() } },
      { provide: BILLING_PROVIDERS, useValue: [provider] }
    ]
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  if (options.trustProxy !== undefined) {
    app.set('trust proxy', options.trustProxy);
  }
  await app.init();
  return { app, server: app.getHttpServer(), verifySpy };
}

describe('Billing webhook source-IP allowlist (e2e)', () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects a non-allowlisted IP with 403 before provider verification runs', async () => {
    let verifySpy: jest.Mock;
    let server: Server;
    ({ app, server, verifySpy } = await makeApp({
      allowlist: '203.0.113.0/24'
    }));

    await request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: makeEvent('evt_denied') }))
      .expect(403);

    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('ignores a spoofed X-Forwarded-For when the peer is not a trusted proxy', async () => {
    let verifySpy: jest.Mock;
    let server: Server;
    ({ app, server, verifySpy } = await makeApp({
      allowlist: '203.0.113.0/24'
    }));

    await request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.5')
      .send(JSON.stringify({ event: makeEvent('evt_spoofed') }))
      .expect(403);

    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('accepts an allowlisted client IP forwarded by a trusted proxy', async () => {
    let server: Server;
    ({ app, server } = await makeApp({
      allowlist: '203.0.113.0/24',
      trustProxy: 'loopback'
    }));

    await request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.5')
      .send(JSON.stringify({ event: makeEvent('evt_forwarded') }))
      .expect(200)
      .expect({ received: true });
  });

  it('accepts a directly connected allowlisted IP', async () => {
    let server: Server;
    ({ app, server } = await makeApp({ allowlist: '127.0.0.1,::1' }));

    await request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: makeEvent('evt_direct') }))
      .expect(200)
      .expect({ received: true });
  });

  it('leaves the receivers open when the allowlist is empty (local dev, e2e)', async () => {
    let server: Server;
    ({ app, server } = await makeApp({ allowlist: '' }));

    await request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: makeEvent('evt_open') }))
      .expect(200)
      .expect({ received: true });
  });
});
