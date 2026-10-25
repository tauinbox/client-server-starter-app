// A YooKassa checkout opens a new payment each time, so a buyer can pay two
// first payments for one `incomplete` row, or pay a link whose plan a later
// checkout replaced. These cases reduce the real webhooks against a real
// PostgreSQL, through the real event bus, into the real admin refund.

import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { FirstPaymentUnclaimedListener } from '../src/modules/billing/listeners/first-payment-unclaimed.listener';
import type { NormalizedInvoicePayload } from '../src/modules/billing/providers/payment-provider.interface';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PRO = 'unclaimed-pro';
const BUSINESS = 'unclaimed-business';

runWithInfra('YooKassa first payment that activates nothing (e2e)', () => {
  let ds: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let module: TestingModule;
  let reducer: BillingEventReducer;
  let refund: jest.Mock;
  let userId: string | undefined;
  let customerId: string | undefined;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    releaseDbLock = await holdBillingDbLock(ds);
    for (const key of [PRO, BUSINESS]) {
      await ds.getRepository(Plan).save(
        ds.getRepository(Plan).create({
          key,
          name: key,
          description: null,
          billingMode: 'fixed',
          interval: 'month',
          meterKey: null,
          entitlements: [],
          limits: null,
          trialDays: 0,
          active: true,
          prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
        })
      );
    }
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  beforeEach(async () => {
    refund = jest.fn().mockResolvedValue(undefined);
    const provider = { id: 'yookassa', refund };
    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        BillingEventReducer,
        BillingAdminService,
        FirstPaymentUnclaimedListener,
        { provide: getDataSourceToken(), useValue: ds },
        ...[Subscription, Invoice, Customer, WebhookEvent].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: ds.getRepository(entity)
        })),
        {
          provide: BillingService,
          useValue: { getProviderById: () => provider }
        },
        {
          provide: EntitlementService,
          useValue: { invalidateUser: jest.fn() }
        },
        { provide: CreditService, useValue: { clawbackPurchase: jest.fn() } },
        { provide: RenewalService, useValue: {} },
        {
          provide: MetricsService,
          useValue: { recordUnmatchedOffSessionCharge: jest.fn() }
        }
      ]
    }).compile();
    // Binds the `@OnEvent` handlers to the bus.
    await module.init();
    reducer = module.get(BillingEventReducer);
  });

  afterEach(async () => {
    await module.close();
    if (customerId) {
      // Invoices hold the customer under RESTRICT, so they go first; the
      // customer, its subscription and its cards then cascade from the user.
      await ds.getRepository(Invoice).delete({ customerId });
      customerId = undefined;
    }
    if (userId) {
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await ds?.getRepository(Plan).delete([{ key: PRO }, { key: BUSINESS }]);
    await releaseDbLock?.();
    await ds?.destroy();
  });

  async function seedIncomplete(planKey: string): Promise<Subscription> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `unclaimed-${stamp}@example.com`,
        name: 'Unclaimed Payment',
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
    return ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey,
        provider: 'yookassa',
        billingMode: 'fixed',
        status: 'incomplete',
        lifecycleOwner: 'self',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
        billingAnchorAt: now,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: null,
        paymentMethodId: null
      })
    );
  }

  function firstPayment(paymentId: string, planKey: string) {
    const payload: NormalizedInvoicePayload = {
      ref: { customerId, userId },
      providerInvoiceRef: paymentId,
      providerSubscriptionId: null,
      amountMinor: 99000,
      currency: 'RUB',
      periodStart: null,
      periodEnd: null,
      paidAt: new Date().toISOString(),
      savedPaymentMethod: {
        providerMethodRef: `pm_${paymentId}`,
        brand: 'Visa',
        last4: '4242'
      },
      planKey
    };
    return reducer.reduce({
      provider: 'yookassa',
      providerEventId: `payment.succeeded:${paymentId}`,
      type: 'invoice.paid',
      payload
    });
  }

  /** The listener runs after the reducer returns; wait for its settle. */
  async function invoicesAfterRefunds(count: number): Promise<Invoice[]> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const invoices = await ds
        .getRepository(Invoice)
        .find({ where: { customerId }, order: { providerInvoiceRef: 'ASC' } });
      const refunded = invoices.filter((i) => i.status === 'refunded');
      if (refunded.length >= count || Date.now() > deadline) return invoices;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it('activates once and refunds the other of two concurrent first payments', async () => {
    const subscription = await seedIncomplete(PRO);
    const runners = [ds.createQueryRunner(), ds.createQueryRunner()];
    await Promise.all(runners.map((r) => r.connect()));
    await Promise.all(runners.map((r) => r.release()));

    await Promise.all([firstPayment('pay_a', PRO), firstPayment('pay_b', PRO)]);
    const invoices = await invoicesAfterRefunds(1);

    const row = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscription.id });
    expect(row.status).toBe('active');
    expect(refund).toHaveBeenCalledTimes(1);
    const [refundedRef] = refund.mock.calls[0] as [string];
    expect(invoices.map((i) => [i.providerInvoiceRef, i.status])).toEqual([
      ['pay_a', refundedRef === 'pay_a' ? 'refunded' : 'paid'],
      ['pay_b', refundedRef === 'pay_b' ? 'refunded' : 'paid']
    ]);
    // Only the payment that activated stores its card.
    const cards = await ds
      .getRepository(PaymentMethod)
      .find({ where: { customerId } });
    expect(cards.map((c) => c.providerMethodRef)).toEqual([
      `pm_${refundedRef === 'pay_a' ? 'pay_b' : 'pay_a'}`
    ]);
    expect(row.paymentMethodId).toBe(cards[0].id);
  }, 30000);

  it('refunds a payment for a plan that a later checkout replaced', async () => {
    const subscription = await seedIncomplete(BUSINESS);

    await firstPayment('pay_pro', PRO);
    const invoices = await invoicesAfterRefunds(1);

    const row = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscription.id });
    expect(row.status).toBe('incomplete');
    expect(row.planKey).toBe(BUSINESS);
    expect(refund).toHaveBeenCalledWith(
      'pay_pro',
      99000,
      expect.stringContaining('refund-')
    );
    expect(invoices.map((i) => i.status)).toEqual(['refunded']);
  }, 30000);

  it('refunds a payment for a row the user cancelled first', async () => {
    const subscription = await seedIncomplete(PRO);
    await ds
      .getRepository(Subscription)
      .update({ id: subscription.id }, { status: 'canceled' });

    await firstPayment('pay_late', PRO);
    const invoices = await invoicesAfterRefunds(1);

    const row = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscription.id });
    expect(row.status).toBe('canceled');
    expect(refund).toHaveBeenCalledTimes(1);
    expect(invoices.map((i) => i.status)).toEqual(['refunded']);
  }, 30000);
});
