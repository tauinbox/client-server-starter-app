// End-to-end coverage for the authenticated billing self-service controller.
// Verifies HTTP serialization (ClassSerializerInterceptor strips the @Exclude'd
// provider references), per-caller scoping (the service is invoked with the
// authenticated user's id — the IDOR boundary), and the @RequireEntitlement
// guard (403 without the capability, 200 with). Auth itself is covered by
// check-auth-coverage.e2e-spec.ts; here a tiny middleware injects req.user so
// the protected handlers can be exercised without a live PostgreSQL.

import { Test } from '@nestjs/testing';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import * as request from 'supertest';
import type { Server } from 'http';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { EntitlementGuard } from '../src/modules/billing/entitlements/entitlement.guard';
import { EntitlementService } from '../src/modules/billing/entitlements/entitlement.service';
import { BillingUserService } from '../src/modules/billing/services/billing-user.service';
import { BillingUserController } from '../src/modules/billing/controllers/billing-user.controller';

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
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z')
  });
}

function makePaymentMethod(): PaymentMethod {
  return Object.assign(new PaymentMethod(), {
    id: 'pm-1',
    customerId: 'cust-1',
    provider: 'yookassa',
    providerMethodRef: 'tok_secret',
    brand: 'Visa',
    last4: '4242',
    isDefault: true,
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
    status: 'paid',
    billingMode: 'fixed',
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd: new Date('2026-07-01T00:00:00Z'),
    paidAt: new Date('2026-06-01T00:05:00Z'),
    receiptRef: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z')
  });
}

describe('Billing user self-service (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const billingUser = {
    getCurrentSubscription: jest.fn(),
    listInvoices: jest.fn(),
    getDefaultPaymentMethod: jest.fn(),
    getUsageSummary: jest.fn(),
    checkout: jest.fn(),
    cancelSubscription: jest.fn(),
    getRegion: jest.fn(),
    setRegion: jest.fn()
  };
  const entitlements = { has: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingUserController],
      providers: [
        { provide: BillingUserService, useValue: billingUser },
        { provide: EntitlementService, useValue: entitlements },
        EntitlementGuard,
        Reflector
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    // Inject the authenticated user (set by the global JwtAuthGuard in prod).
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = (req.headers['x-test-user'] as string) ?? 'user-1';
      (req as Request & { user: { userId: string } }).user = { userId };
      next();
    });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('serializes a subscription without the internal provider reference', async () => {
    billingUser.getCurrentSubscription.mockResolvedValue(makeSubscription());

    const res = await request(server)
      .get('/api/v1/billing/subscription')
      .expect(200);

    const body = res.body as { provider: string; status: string };
    expect(body.provider).toBe('yookassa');
    expect(body.status).toBe('active');
    expect(res.body).not.toHaveProperty('providerSubscriptionId');
  });

  it('serializes the saved method without the raw provider token', async () => {
    billingUser.getDefaultPaymentMethod.mockResolvedValue(makePaymentMethod());

    const res = await request(server)
      .get('/api/v1/billing/payment-method')
      .expect(200);

    expect((res.body as { last4: string }).last4).toBe('4242');
    expect(res.body).not.toHaveProperty('providerMethodRef');
  });

  it('serializes invoices without the provider event id', async () => {
    billingUser.listInvoices.mockResolvedValue([makeInvoice()]);

    const res = await request(server)
      .get('/api/v1/billing/invoices')
      .expect(200);

    const invoices = res.body as Array<{ providerInvoiceRef: string }>;
    expect(invoices).toHaveLength(1);
    expect(invoices[0].providerInvoiceRef).toBe('pay_1');
    expect(invoices[0]).not.toHaveProperty('providerEventId');
  });

  it('returns the current-period usage summary for the caller', async () => {
    billingUser.getUsageSummary.mockResolvedValue({
      subscriptionId: 'sub-1',
      meterKey: 'api_calls',
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-07-01T00:00:00Z'),
      totalUnits: 142,
      includedUnits: 100,
      billableUnits: 42,
      unitPriceMinor: 200,
      amountMinor: 8400,
      currency: 'RUB'
    });

    const res = await request(server)
      .get('/api/v1/billing/usage')
      .set('x-test-user', 'user-7')
      .expect(200);

    expect(billingUser.getUsageSummary).toHaveBeenCalledWith('user-7');
    expect(res.body).toEqual({
      subscriptionId: 'sub-1',
      meterKey: 'api_calls',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-07-01T00:00:00.000Z',
      totalUnits: 142,
      includedUnits: 100,
      billableUnits: 42,
      unitPriceMinor: 200,
      amountMinor: 8400,
      currency: 'RUB'
    });
  });

  it('scopes reads to the authenticated user (IDOR boundary)', async () => {
    billingUser.getCurrentSubscription.mockResolvedValue(null);

    await request(server)
      .get('/api/v1/billing/subscription')
      .set('x-test-user', 'attacker-id')
      .expect(200);

    expect(billingUser.getCurrentSubscription).toHaveBeenCalledWith(
      'attacker-id'
    );
  });

  it('starts a checkout for the resolved provider', async () => {
    billingUser.checkout.mockResolvedValue({
      provider: 'yookassa',
      url: 'https://checkout/x',
      sessionRef: 'sess-1'
    });

    const res = await request(server)
      .post('/api/v1/billing/checkout')
      .send({ planKey: 'pro' })
      .expect(200);

    expect(billingUser.checkout).toHaveBeenCalledWith('user-1', 'pro');
    expect(res.body).toEqual({
      provider: 'yookassa',
      url: 'https://checkout/x',
      sessionRef: 'sess-1'
    });
  });

  it('cancels the current subscription at period end', async () => {
    billingUser.cancelSubscription.mockResolvedValue(
      Object.assign(makeSubscription(), { cancelAtPeriodEnd: true })
    );

    const res = await request(server)
      .post('/api/v1/billing/subscription/cancel')
      .send({})
      .expect(200);

    expect(billingUser.cancelSubscription).toHaveBeenCalledWith(
      'user-1',
      undefined
    );
    expect((res.body as { cancelAtPeriodEnd: boolean }).cancelAtPeriodEnd).toBe(
      true
    );
  });

  describe('entitlement enforcement (@RequireEntitlement)', () => {
    it('returns 403 when the caller lacks the capability', async () => {
      entitlements.has.mockResolvedValue(false);

      await request(server).get('/api/v1/billing/premium-content').expect(403);
    });

    it('returns the content when the capability is granted', async () => {
      entitlements.has.mockResolvedValue(true);

      const res = await request(server)
        .get('/api/v1/billing/premium-content')
        .expect(200);

      expect(res.body).toEqual({ available: true });
      expect(entitlements.has).toHaveBeenCalledWith('user-1', 'reports');
    });
  });
});
