// End-to-end coverage for the public billing plan catalog: GET /billing/plans
// returns only active plans, serialized to the wire shape (dates as ISO strings,
// per-provider prices map), reachable without authentication — without a running
// PostgreSQL. Mirrors the billing-webhook e2e harness (in-memory repo + supertest).

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VersioningType, type INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import type { Server } from 'http';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { PlanService } from '../src/modules/billing/services/plan.service';
import { BillingPlansController } from '../src/modules/billing/controllers/billing-plans.controller';

function makePlan(overrides: Partial<Plan>): Plan {
  return {
    id: 'plan-id',
    key: 'free',
    name: 'Free',
    description: 'Core access at no cost',
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: [],
    limits: null,
    trialDays: 0,
    active: true,
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 0 },
      paddle: { currency: 'USD', amountMinor: 0 }
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides
  };
}

describe('Billing plan catalog (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let store: Plan[];

  beforeEach(async () => {
    store = [
      makePlan({ id: 'p-free', key: 'free' }),
      makePlan({
        id: 'p-pro',
        key: 'pro',
        name: 'Pro',
        entitlements: ['reports', 'api-access'],
        prices: {
          yookassa: { currency: 'RUB', amountMinor: 99000 },
          paddle: { currency: 'USD', amountMinor: 1200 }
        }
      }),
      makePlan({ id: 'p-usage', key: 'usage', active: false })
    ];

    const planRepo = {
      find: (opts: { where?: { active?: boolean } }) => {
        const active = opts?.where?.active;
        const rows =
          active === undefined
            ? store
            : store.filter((p) => p.active === active);
        return Promise.resolve(rows);
      }
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingPlansController],
      providers: [
        PlanService,
        { provide: getRepositoryToken(Plan), useValue: planRepo }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns only active plans, anonymously, in wire shape', async () => {
    const res = await request(server).get('/api/v1/billing/plans').expect(200);

    const body = res.body as Array<{
      key: string;
      prices: { yookassa: { currency: string; amountMinor: number } };
      createdAt: string;
    }>;

    const keys = body.map((p) => p.key);
    expect(keys).toEqual(['free', 'pro']);
    expect(keys).not.toContain('usage');

    const pro = body.find((p) => p.key === 'pro');
    expect(pro?.prices.yookassa).toEqual({
      currency: 'RUB',
      amountMinor: 99000
    });
    // Dates serialize to ISO strings on the wire.
    expect(typeof pro?.createdAt).toBe('string');
  });
});
