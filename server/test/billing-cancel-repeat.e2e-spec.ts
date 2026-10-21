// A period-end cancel is one decision per period: a repeat, or a period-end
// cancel of a row with no paid period, answers 409 before the provider call
// and leaves no second audit entry. These cases run the admin route and the
// real service against a real PostgreSQL.

import { Test } from '@nestjs/testing';
import {
  ValidationPipe,
  VersioningType,
  type INestApplication
} from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { Server } from 'http';
import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import type { SubscriptionStatus } from '@app/shared/types';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { BillingAdminController } from '../src/modules/billing/controllers/billing-admin.controller';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { UsageService } from '../src/modules/billing/services/usage.service';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { MfaRequiredGuard } from '../src/modules/auth/guards/mfa-required.guard';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLogInterceptor } from '../src/modules/audit/interceptors/audit-log.interceptor';
import { RESPONSE_SERIALIZER } from '../src/modules/core/interceptors/response-serializer.provider';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('A repeated period-end cancel (e2e)', () => {
  let ds: DataSource;
  let app: INestApplication;
  let server: Server;
  let userId: string | undefined;
  let subscriptionId: string;
  const providerCancel = jest.fn();
  const audit = { log: jest.fn(), logFireAndForget: jest.fn() };

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingAdminController],
      providers: [
        RESPONSE_SERIALIZER,
        BillingAdminService,
        { provide: getDataSourceToken(), useValue: ds },
        ...[Subscription, Invoice, Customer, WebhookEvent].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: ds.getRepository(entity)
        })),
        {
          provide: BillingService,
          useValue: { getProviderById: () => ({ cancel: providerCancel }) }
        },
        {
          provide: RenewalService,
          useValue: { billClosingUsagePeriod: jest.fn() }
        },
        {
          provide: CreditService,
          useValue: { releaseHolds: () => Promise.resolve() }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: UsageService, useValue: { record: jest.fn() } },
        { provide: AuditService, useValue: audit },
        { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
        Reflector
      ]
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
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

  beforeEach(() => {
    jest.clearAllMocks();
    providerCancel.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (userId) {
      // The customer and its subscriptions cascade from the user.
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await app?.close();
    await ds?.destroy();
  });

  async function seed(status: SubscriptionStatus): Promise<void> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `cancel-repeat-${stamp}@example.com`,
        firstName: 'Cancel',
        lastName: 'Repeat',
        password: 'hashed'
      })
    );
    userId = user.id;
    const customer = await ds.getRepository(Customer).save(
      ds.getRepository(Customer).create({
        userId: user.id,
        provider: 'paddle',
        providerOverride: null,
        providerCustomerId: `ctm_${stamp}`,
        country: 'US',
        currency: 'USD',
        defaultPaymentMethodId: null
      })
    );
    const now = Date.now();
    const subscription = await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey: 'pro',
        provider: 'paddle',
        billingMode: 'fixed',
        status,
        lifecycleOwner: 'provider',
        currentPeriodStart: new Date(now),
        currentPeriodEnd: new Date(now + 30 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
        providerSubscriptionId: `sub_${stamp}`
      })
    );
    subscriptionId = subscription.id;
  }

  function cancel(mode: 'period_end' | 'immediate') {
    return request(server)
      .post(`/api/v1/admin/billing/subscriptions/${subscriptionId}/cancel`)
      .send({ mode });
  }

  function row(): Promise<Subscription> {
    return ds.getRepository(Subscription).findOneByOrFail({
      id: subscriptionId
    });
  }

  it('refuses the second period-end cancel with one provider call and one audit entry', async () => {
    await seed('active');

    await cancel('period_end').expect(200);
    const second = await cancel('period_end').expect(409);

    expect(second.body).toMatchObject({
      errorKey: ErrorKeys.BILLING.CANCELLATION_ALREADY_SCHEDULED
    });
    expect(providerCancel).toHaveBeenCalledTimes(1);
    expect(audit.logFireAndForget).toHaveBeenCalledTimes(1);
    expect(audit.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.BILLING_SUBSCRIPTION_CANCEL,
        targetId: subscriptionId
      })
    );
    expect(await row()).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: true
    });
  });

  it('refuses a period-end cancel of an incomplete row and leaves it unchanged', async () => {
    await seed('incomplete');

    const res = await cancel('period_end').expect(409);

    expect(res.body).toMatchObject({
      message: 'This subscription has no paid period to end.',
      errorKey: ErrorKeys.BILLING.CANCELLATION_ALREADY_SCHEDULED
    });
    expect(providerCancel).not.toHaveBeenCalled();
    expect(audit.logFireAndForget).not.toHaveBeenCalled();
    expect(await row()).toMatchObject({
      status: 'incomplete',
      cancelAtPeriodEnd: false
    });
  });

  it('still ends a scheduled row immediately', async () => {
    await seed('active');
    await cancel('period_end').expect(200);

    await cancel('immediate').expect(200);

    expect(await row()).toMatchObject({
      status: 'canceled',
      cancelAtPeriodEnd: false
    });
  });
});
