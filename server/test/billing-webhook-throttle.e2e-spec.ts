// Providers deliver webhooks from a few stable egress IPs, so one provider's
// deliveries share a single per-IP throttle bucket; the receivers must skip
// the global throttle or a renewal batch gets 429'd. Runs the controller
// behind the same throttler set CoreModule registers.

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VersioningType, type INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import type { Server } from 'http';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS
} from '@app/shared/constants/auth.constants';
import { LoginThrottlerGuard } from '../src/modules/core/login-throttler.guard';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import type {
  NormalizedEvent,
  PaymentProvider
} from '../src/modules/billing/providers/payment-provider.interface';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { WebhookIngestionService } from '../src/modules/billing/webhooks/webhook-ingestion.service';
import { BillingWebhooksController } from '../src/modules/billing/webhooks/billing-webhooks.controller';

// Default global throttler from CoreModule: { ttl: 60000, limit: 120 }.
const GLOBAL_LIMIT = 120;

function makeStubProvider(): PaymentProvider {
  return {
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
    verifyAndParseWebhook: (rawBody: Buffer) => {
      const parsed = JSON.parse(rawBody.toString('utf8')) as {
        event: NormalizedEvent | null;
      };
      return Promise.resolve(parsed.event);
    }
  } as PaymentProvider;
}

function makeWebhookEventRepo() {
  const rows: Array<{
    id: string;
    provider: string;
    providerEventId: string;
    status: string;
  }> = [];
  let seq = 0;
  return {
    createQueryBuilder: () => {
      const captured: {
        values?: { provider: string; providerEventId: string; status: string };
      } = {};
      const builder = {
        insert: () => builder,
        values: (v: {
          provider: string;
          providerEventId: string;
          status: string;
        }) => {
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
          rows.push({
            id,
            provider: v.provider,
            providerEventId: v.providerEventId,
            status: v.status
          });
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    },
    findOne: (opts: { where: { provider: string; providerEventId: string } }) =>
      Promise.resolve(
        rows.find(
          (e) =>
            e.provider === opts.where.provider &&
            e.providerEventId === opts.where.providerEventId
        ) ?? null
      ),
    update: (where: { id: string }, set: Record<string, unknown>) => {
      const matches = rows.filter((e) => e.id === where.id);
      for (const row of matches) Object.assign(row, set);
      return Promise.resolve({ affected: matches.length });
    }
  };
}

describe('Billing webhook throttle exemption (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [
            { ttl: 60000, limit: GLOBAL_LIMIT },
            {
              name: 'login-long-window',
              ttl: LOCKOUT_DURATION_MS,
              limit: MAX_FAILED_ATTEMPTS * 1000
            }
          ]
        })
      ],
      controllers: [BillingWebhooksController],
      providers: [
        WebhookIngestionService,
        // WebhookIpAllowlistGuard dep; unset allowlist keeps the receivers open
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: makeWebhookEventRepo()
        },
        { provide: BillingEventReducer, useValue: { reduce: jest.fn() } },
        { provide: BILLING_PROVIDERS, useValue: [makeStubProvider()] },
        { provide: APP_GUARD, useClass: LoginThrottlerGuard }
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
    providerEventId: 'evt_burst_1',
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

  it('accepts a same-IP burst above the global limit on the paddle receiver', async () => {
    for (let i = 0; i <= GLOBAL_LIMIT; i++) {
      await request(server)
        .post('/api/v1/billing/webhooks/paddle')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event: activationEvent }))
        .expect(200)
        .expect({ received: true });
    }
  });

  it('never throttles the yookassa receiver even when every request is rejected', async () => {
    // No yookassa provider is registered in this module, so ingestion rejects
    // each request with 400 - which must stay 400 (never 429) above the limit.
    for (let i = 0; i <= GLOBAL_LIMIT; i++) {
      await request(server)
        .post('/api/v1/billing/webhooks/yookassa')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event: activationEvent }))
        .expect(400);
    }
  });

  it('still rejects an unverifiable body with 400', async () => {
    await request(server)
      .post('/api/v1/billing/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: null }))
      .expect(400);
  });
});
