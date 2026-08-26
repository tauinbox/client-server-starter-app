// An admin refund prices the leg, calls the payment provider, then records the
// money - so two legs started from the same base used to both reach the
// provider. These cases run the real repository against a real PostgreSQL and
// start the second leg from inside the provider stub, where the window is.

import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { CreditService } from '../src/modules/billing/services/credit.service';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const INVOICE_MINOR = 99000;

/** What the second refund leg does while the first one is at the provider. */
type ConcurrentLeg = (invoiceId: string) => Promise<unknown>;

runWithInfra('Admin refund vs. a concurrent refund leg (e2e)', () => {
  let ds: DataSource;
  let service: BillingAdminService;
  let refund: jest.Mock;
  let userId: string | undefined;
  let customerId: string | undefined;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
  }, 30000);

  afterEach(async () => {
    if (customerId) {
      // Invoices hold the customer under RESTRICT, so they go first.
      await ds.getRepository(Invoice).delete({ customerId });
      customerId = undefined;
    }
    if (userId) {
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  /**
   * The second connection has to exist before the race starts: opening one
   * costs more than the whole leg it would carry.
   */
  async function warmPool(): Promise<void> {
    const runners = [ds.createQueryRunner(), ds.createQueryRunner()];
    await Promise.all(runners.map((r) => r.connect()));
    await Promise.all(runners.map((r) => r.release()));
  }

  async function seedPaidInvoice(): Promise<Invoice> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `refund-race-${stamp}@example.com`,
        firstName: 'Refund',
        lastName: 'Race',
        password: 'hashed'
      })
    );
    userId = user.id;

    const customer = await ds.getRepository(Customer).save(
      ds.getRepository(Customer).create({
        userId: user.id,
        provider: 'yookassa',
        providerOverride: null,
        providerCustomerId: `cus_${stamp}`,
        country: 'RU',
        currency: 'RUB',
        defaultPaymentMethodId: null
      })
    );
    customerId = customer.id;

    const now = new Date();
    return ds.getRepository(Invoice).save(
      ds.getRepository(Invoice).create({
        customerId: customer.id,
        subscriptionId: null,
        provider: 'yookassa',
        providerEventId: `refund-race-${stamp}`,
        providerInvoiceRef: `pay_${stamp}`,
        amountMinor: Money.fromMinor(INVOICE_MINOR),
        refundedMinor: Money.fromMinor(0),
        currency: 'RUB',
        status: 'paid',
        creditUnitsApplied: 0,
        billingMode: 'fixed',
        kind: 'subscription',
        productId: null,
        periodStart: now,
        periodEnd: now,
        paidAt: now,
        receiptRef: null
      })
    );
  }

  /**
   * A provider whose in-flight refund runs `duringCall` - the interleaving the
   * production window allows, made deterministic.
   */
  function providerStub(invoiceId: string, duringCall: ConcurrentLeg | null) {
    let first = true;
    refund = jest.fn(async () => {
      if (first && duringCall) {
        first = false;
        await duringCall(invoiceId);
      }
    });
    return { id: 'yookassa', refund, cancel: jest.fn() };
  }

  async function buildService(
    provider: ReturnType<typeof providerStub>
  ): Promise<BillingAdminService> {
    const module = await Test.createTestingModule({
      providers: [
        BillingAdminService,
        { provide: getDataSourceToken(), useValue: ds },
        {
          provide: getRepositoryToken(Subscription),
          useValue: ds.getRepository(Subscription)
        },
        {
          provide: getRepositoryToken(Invoice),
          useValue: ds.getRepository(Invoice)
        },
        {
          provide: getRepositoryToken(Customer),
          useValue: ds.getRepository(Customer)
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: ds.getRepository(WebhookEvent)
        },
        {
          provide: BillingService,
          useValue: { getProviderById: () => provider }
        },
        {
          provide: EntitlementService,
          useValue: { invalidateUser: jest.fn() }
        },
        { provide: CreditService, useValue: { clawbackPurchase: jest.fn() } },
        {
          provide: RenewalService,
          useValue: { billClosingUsagePeriod: jest.fn() }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
      ]
    }).compile();
    return module.get(BillingAdminService);
  }

  async function setup(
    duringCall: ConcurrentLeg | null
  ): Promise<{ invoice: Invoice }> {
    const invoice = await seedPaidInvoice();
    service = await buildService(providerStub(invoice.id, duringCall));
    await warmPool();
    return { invoice };
  }

  function reload(id: string): Promise<Invoice | null> {
    return ds.getRepository(Invoice).findOne({ where: { id } });
  }

  it('refuses a second leg that no longer fits, before it reaches the provider', async () => {
    let secondLeg: unknown;
    const { invoice } = await setup(async (id) => {
      secondLeg = await service
        .refundInvoice(id, 50000)
        .catch((error: unknown) => error);
    });

    await service.refundInvoice(invoice.id, 60000);

    // 60000 + 50000 exceeds the 99000 invoice: the second leg used to price
    // itself against a zero base and move real money anyway.
    expect(secondLeg).toBeInstanceOf(BadRequestException);
    expect(refund).toHaveBeenCalledTimes(1);
    const row = await reload(invoice.id);
    expect(row?.refundedMinor.toNumber()).toBe(60000);
    expect(row?.status).toBe('paid');
  }, 30000);

  it('lets a second leg that still fits through and settles the invoice once', async () => {
    let secondLeg: unknown;
    const { invoice } = await setup(async (id) => {
      secondLeg = await service.refundInvoice(id, 39000);
    });

    await service.refundInvoice(invoice.id, 60000);

    expect(refund).toHaveBeenCalledTimes(2);
    // The leg whose own cumulative reaches the total is the one that settles.
    expect((secondLeg as Invoice).status).toBe('refunded');
    const row = await reload(invoice.id);
    expect(row?.refundedMinor.toNumber()).toBe(INVOICE_MINOR);
    expect(row?.status).toBe('refunded');
  }, 30000);

  it('gives the reservation back when the provider call fails', async () => {
    const { invoice } = await setup(null);
    refund.mockRejectedValueOnce(new Error('provider down'));

    await expect(service.refundInvoice(invoice.id, 60000)).rejects.toThrow(
      'provider down'
    );

    const released = await reload(invoice.id);
    expect(released?.refundedMinor.toNumber()).toBe(0);
    expect(released?.status).toBe('paid');

    // The whole amount is refundable again once the reservation is released.
    await service.refundInvoice(invoice.id);
    const row = await reload(invoice.id);
    expect(row?.refundedMinor.toNumber()).toBe(INVOICE_MINOR);
    expect(row?.status).toBe('refunded');
  }, 30000);
});
