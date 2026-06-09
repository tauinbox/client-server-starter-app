// End-to-end coverage for the admin billing controller (design §11).
// Verifies the CASL `manage Billing` boundary (non-admin → 403, admin → 200),
// HTTP serialization (ClassSerializerInterceptor strips @Exclude'd provider
// refs), and that cancel/refund dispatch to the service. The PermissionsGuard is
// replaced with a test stand-in keyed on a header so authorization is exercised
// without a live RBAC stack; auth (401) is covered by check-auth-coverage.

import { Test } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  ValidationPipe,
  VersioningType,
  type INestApplication
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import * as request from 'supertest';
import type { Server } from 'http';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { UsageService } from '../src/modules/billing/services/usage.service';
import { BillingAdminController } from '../src/modules/billing/controllers/billing-admin.controller';

class TestPermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.headers['x-test-role'] !== 'admin') {
      throw new ForbiddenException();
    }
    return true;
  }
}

function makeSubscription(): Subscription {
  return Object.assign(new Subscription(), {
    id: 'sub-1',
    customerId: 'cust-1',
    planKey: 'pro',
    provider: 'yookassa',
    billingMode: 'fixed',
    status: 'active',
    lifecycleOwner: 'self',
    currentPeriodStart: new Date('2026-06-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    providerSubscriptionId: 'pay_secret_ref',
    paymentMethodId: 'pm-1',
    dunningAttempts: 0,
    nextRenewalAttemptAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z')
  });
}

function makeInvoice(): Invoice {
  return Object.assign(new Invoice(), {
    id: 'inv-1',
    customerId: 'cust-1',
    subscriptionId: 'sub-1',
    provider: 'yookassa',
    providerEventId: 'evt_secret',
    providerInvoiceRef: 'pay_1',
    amountMinor: 99000,
    currency: 'RUB',
    status: 'refunded',
    billingMode: 'fixed',
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd: new Date('2026-07-01T00:00:00Z'),
    paidAt: new Date('2026-06-01T00:05:00Z'),
    receiptRef: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z')
  });
}

describe('Billing admin (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const billingAdmin = {
    listSubscriptions: jest.fn(),
    listInvoices: jest.fn(),
    cancelSubscription: jest.fn(),
    refundInvoice: jest.fn()
  };
  const usage = {
    record: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingAdminController],
      providers: [
        { provide: BillingAdminService, useValue: billingAdmin },
        { provide: UsageService, useValue: usage },
        Reflector
      ]
    })
      .overrideGuard(PermissionsGuard)
      .useClass(TestPermissionsGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: { userId: string } }).user = {
        userId: 'admin-1'
      };
      next();
    });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  const uuid = '123e4567-e89b-12d3-a456-426614174000';

  it('denies a non-admin caller (403)', async () => {
    await request(server)
      .get('/api/v1/admin/billing/subscriptions')
      .expect(403);
    expect(billingAdmin.listSubscriptions).not.toHaveBeenCalled();
  });

  it('lists subscriptions for an admin without the internal provider ref', async () => {
    billingAdmin.listSubscriptions.mockResolvedValue([makeSubscription()]);

    const res = await request(server)
      .get('/api/v1/admin/billing/subscriptions')
      .set('x-test-role', 'admin')
      .expect(200);

    const subs = res.body as Array<Record<string, unknown>>;
    expect(subs).toHaveLength(1);
    expect(subs[0]).not.toHaveProperty('providerSubscriptionId');
  });

  it('lists invoices for an admin without the provider event id', async () => {
    billingAdmin.listInvoices.mockResolvedValue([makeInvoice()]);

    const res = await request(server)
      .get('/api/v1/admin/billing/invoices')
      .set('x-test-role', 'admin')
      .expect(200);

    const invoices = res.body as Array<{ providerInvoiceRef: string }>;
    expect(invoices[0]).not.toHaveProperty('providerEventId');
    expect(invoices[0].providerInvoiceRef).toBe('pay_1');
  });

  it('cancels a subscription by id (immediate)', async () => {
    billingAdmin.cancelSubscription.mockResolvedValue(
      Object.assign(makeSubscription(), {
        status: 'canceled',
        cancelAtPeriodEnd: false
      })
    );

    const res = await request(server)
      .post(`/api/v1/admin/billing/subscriptions/${uuid}/cancel`)
      .set('x-test-role', 'admin')
      .send({ mode: 'immediate' })
      .expect(200);

    expect(billingAdmin.cancelSubscription).toHaveBeenCalledWith(
      uuid,
      'immediate'
    );
    expect((res.body as { status: string }).status).toBe('canceled');
  });

  it('refunds an invoice by id (partial amount)', async () => {
    billingAdmin.refundInvoice.mockResolvedValue(makeInvoice());

    await request(server)
      .post(`/api/v1/admin/billing/invoices/${uuid}/refund`)
      .set('x-test-role', 'admin')
      .send({ amountMinor: 50000 })
      .expect(200);

    expect(billingAdmin.refundInvoice).toHaveBeenCalledWith(uuid, 50000);
  });

  it('rejects an invalid refund amount via DTO validation (400)', async () => {
    await request(server)
      .post(`/api/v1/admin/billing/invoices/${uuid}/refund`)
      .set('x-test-role', 'admin')
      .send({ amountMinor: -5 })
      .expect(400);
    expect(billingAdmin.refundInvoice).not.toHaveBeenCalled();
  });

  it('records a usage event for an admin and hides the idempotency key', async () => {
    usage.record.mockResolvedValue(
      Object.assign(new UsageRecord(), {
        id: 'usage-1',
        customerId: uuid,
        subscriptionId: 'sub-1',
        meterKey: 'api_calls',
        quantity: 42,
        occurredAt: new Date('2026-06-01T00:00:00Z'),
        idempotencyKey: 'evt-secret',
        recordedAt: new Date('2026-06-01T00:00:01Z')
      })
    );

    const res = await request(server)
      .post('/api/v1/admin/billing/usage')
      .set('x-test-role', 'admin')
      .send({
        customerId: uuid,
        meterKey: 'api_calls',
        quantity: 42,
        idempotencyKey: 'evt-secret'
      })
      .expect(201);

    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: uuid,
        meterKey: 'api_calls',
        quantity: 42,
        idempotencyKey: 'evt-secret'
      })
    );
    expect(res.body).not.toHaveProperty('idempotencyKey');
    expect((res.body as { quantity: number }).quantity).toBe(42);
  });

  it('denies a non-admin recording usage (403)', async () => {
    await request(server)
      .post('/api/v1/admin/billing/usage')
      .send({
        customerId: uuid,
        meterKey: 'api_calls',
        quantity: 1,
        idempotencyKey: 'evt-1'
      })
      .expect(403);
    expect(usage.record).not.toHaveBeenCalled();
  });

  it('rejects an invalid usage payload via DTO validation (400)', async () => {
    await request(server)
      .post('/api/v1/admin/billing/usage')
      .set('x-test-role', 'admin')
      .send({ customerId: 'not-a-uuid', meterKey: '', quantity: 0 })
      .expect(400);
    expect(usage.record).not.toHaveBeenCalled();
  });
});
