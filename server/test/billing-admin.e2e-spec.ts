// End-to-end coverage for the admin billing controller: the CASL
// `manage Billing` boundary, @Exclude'd provider refs staying out of responses,
// service dispatch, and the audit trail every mutation must leave (the real
// AuditLogInterceptor runs against a mocked AuditService). The PermissionsGuard
// is a header-keyed stand-in; auth (401) is covered by check-auth-coverage.

import { Test } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  ValidationPipe,
  VersioningType,
  type INestApplication
} from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
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
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLogInterceptor } from '../src/modules/audit/interceptors/audit-log.interceptor';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { MAX_PAGE_SIZE } from '@app/shared/constants/pagination.constants';
import { CursorPaginatedResponseDto } from '../src/common/dtos/cursor-paginated-response.dto';

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
    kind: 'subscription',
    productId: null,
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
    refundInvoice: jest.fn(),
    replayWebhookEvent: jest.fn()
  };
  const usage = {
    record: jest.fn()
  };
  const audit = {
    log: jest.fn(),
    logFireAndForget: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingAdminController],
      providers: [
        { provide: BillingAdminService, useValue: billingAdmin },
        { provide: UsageService, useValue: usage },
        { provide: AuditService, useValue: audit },
        { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
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
    billingAdmin.listSubscriptions.mockResolvedValue(
      new CursorPaginatedResponseDto([makeSubscription()], null, 20)
    );

    const res = await request(server)
      .get('/api/v1/admin/billing/subscriptions')
      .set('x-test-role', 'admin')
      .expect(200);

    const body = res.body as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty('providerSubscriptionId');
  });

  it('lists invoices for an admin without the provider event id', async () => {
    billingAdmin.listInvoices.mockResolvedValue(
      new CursorPaginatedResponseDto([makeInvoice()], 'cursor-1', 20)
    );

    const res = await request(server)
      .get('/api/v1/admin/billing/invoices')
      .set('x-test-role', 'admin')
      .expect(200);

    const body = res.body as {
      data: Array<{ providerInvoiceRef: string }>;
      meta: { nextCursor: string | null; hasMore: boolean; limit: number };
    };
    expect(body.data[0]).not.toHaveProperty('providerEventId');
    expect(body.data[0].providerInvoiceRef).toBe('pay_1');
    expect(body.meta).toEqual({
      nextCursor: 'cursor-1',
      hasMore: true,
      limit: 20
    });
  });

  it('passes the cursor and limit through to the service', async () => {
    billingAdmin.listInvoices.mockResolvedValue(
      new CursorPaginatedResponseDto([], null, 25)
    );

    await request(server)
      .get('/api/v1/admin/billing/invoices?cursor=abc&limit=25')
      .set('x-test-role', 'admin')
      .expect(200);

    expect(billingAdmin.listInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'abc', limit: 25 })
    );
  });

  it('rejects a sortBy outside the invoice whitelist (400)', async () => {
    await request(server)
      .get('/api/v1/admin/billing/invoices?sortBy=amountMinor')
      .set('x-test-role', 'admin')
      .expect(400);

    expect(billingAdmin.listInvoices).not.toHaveBeenCalled();
  });

  it('rejects a limit above the maximum page size (400)', async () => {
    await request(server)
      .get(`/api/v1/admin/billing/invoices?limit=${MAX_PAGE_SIZE + 1}`)
      .set('x-test-role', 'admin')
      .expect(400);

    await request(server)
      .get(`/api/v1/admin/billing/subscriptions?limit=${MAX_PAGE_SIZE + 1}`)
      .set('x-test-role', 'admin')
      .expect(400);

    expect(billingAdmin.listInvoices).not.toHaveBeenCalled();
    expect(billingAdmin.listSubscriptions).not.toHaveBeenCalled();
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

  it('replays a dead-lettered webhook event by id', async () => {
    billingAdmin.replayWebhookEvent.mockResolvedValue({
      id: uuid,
      status: 'received'
    });

    await request(server)
      .post(`/api/v1/admin/billing/webhook-events/${uuid}/replay`)
      .set('x-test-role', 'admin')
      .expect(200);

    expect(billingAdmin.replayWebhookEvent).toHaveBeenCalledWith(uuid);
  });

  it('audits a webhook replay with the event id', async () => {
    billingAdmin.replayWebhookEvent.mockResolvedValue({
      id: uuid,
      status: 'received'
    });

    await request(server)
      .post(`/api/v1/admin/billing/webhook-events/${uuid}/replay`)
      .set('x-test-role', 'admin')
      .expect(200);

    expect(audit.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.BILLING_WEBHOOK_EVENT_REPLAY,
        actorId: 'admin-1',
        targetId: uuid,
        targetType: 'WebhookEvent',
        details: { status: 'received' }
      })
    );
  });

  it('audits a recorded usage event with the new record id', async () => {
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

    await request(server)
      .post('/api/v1/admin/billing/usage')
      .set('x-test-role', 'admin')
      .send({
        customerId: uuid,
        meterKey: 'api_calls',
        quantity: 42,
        idempotencyKey: 'evt-secret'
      })
      .expect(201);

    expect(audit.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.BILLING_USAGE_RECORD,
        actorId: 'admin-1',
        targetId: 'usage-1',
        targetType: 'UsageRecord',
        details: { customerId: uuid, meterKey: 'api_calls', quantity: 42 }
      })
    );
  });

  it('leaves no audit entry when a mutation fails', async () => {
    usage.record.mockRejectedValue(new Error('boom'));

    await request(server)
      .post('/api/v1/admin/billing/usage')
      .set('x-test-role', 'admin')
      .send({
        customerId: uuid,
        meterKey: 'api_calls',
        quantity: 1,
        idempotencyKey: 'evt-1'
      })
      .expect(500);

    expect(audit.logFireAndForget).not.toHaveBeenCalled();
  });
});
