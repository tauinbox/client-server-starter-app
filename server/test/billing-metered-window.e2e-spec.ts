// A switch between a fixed and a usage plan closes the metered window at the
// switch. Real services on a real PostgreSQL; only the provider is a fake that
// records its calls.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Money } from '@app/shared/utils/money';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { CreditBalance } from '../src/modules/billing/entities/credit-balance.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { UsagePeriodClosedEvent } from '../src/modules/billing/events/billing.events';
import {
  BILLING_PROVIDERS,
  type ChargeResult,
  type PaymentProvider
} from '../src/modules/billing/providers/payment-provider.interface';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { ProrationCalculator } from '../src/modules/billing/rating/proration-calculator';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { BillingUserService } from '../src/modules/billing/services/billing-user.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { UsageInvoicingService } from '../src/modules/billing/services/usage-invoicing.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY_MS = 86_400_000;
const FIXED_KEY = 'metered-window-fixed';
const USAGE_KEY = 'metered-window-usage';

type FakeProvider = PaymentProvider & {
  chargeOffSession: jest.Mock;
  chargeUsage: jest.Mock;
  changePlan: jest.Mock;
};

function fakeProvider(id: BillingProviderId): FakeProvider {
  return {
    id,
    managesLifecycle: id === 'paddle',
    ensureCustomer: jest.fn(),
    startCheckout: jest.fn(),
    chargeOffSession: jest.fn<
      Promise<ChargeResult>,
      Parameters<PaymentProvider['chargeOffSession']>
    >((_customer, _amount, _currency, _items, key) =>
      Promise.resolve({ providerInvoiceRef: `pay_${key}`, status: 'captured' })
    ),
    findOffSessionCharge: jest.fn().mockResolvedValue(null),
    getOffSessionCharge: jest.fn().mockResolvedValue(null),
    createOneTimePayment: jest.fn(),
    chargeUsage: jest.fn().mockResolvedValue(undefined),
    changePlan: jest.fn().mockResolvedValue(undefined),
    previewChangePlan: jest.fn(),
    updatePaymentMethod: jest.fn(),
    cancel: jest.fn().mockResolvedValue(undefined),
    refund: jest.fn().mockResolvedValue(undefined),
    verifyAndParseWebhook: jest.fn()
  };
}

runWithInfra('Metered window across a switch of billing mode (e2e)', () => {
  let ds: DataSource;
  let userId: string | undefined;
  let customerId: string | undefined;
  let subscriptionId: string;
  let providerSubscriptionRef: string;
  let provider: FakeProvider;
  let emitted: Array<{ name: string; payload: unknown }>;
  let users: BillingUserService;
  let renewals: RenewalService;
  let invoicing: UsageInvoicingService;
  let reducer: BillingEventReducer;

  const periodStart = new Date(Date.now() - 10 * DAY_MS);
  const periodEnd = new Date(Date.now() + 20 * DAY_MS);
  const afterPeriodEnd = new Date(periodEnd.getTime() + 1000);

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    const plans = ds.getRepository(Plan);
    await plans.save([
      plans.create({
        key: FIXED_KEY,
        name: 'Fixed',
        description: null,
        billingMode: 'fixed',
        interval: 'month',
        meterKey: null,
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: {
          yookassa: { currency: 'RUB', amountMinor: 99000 },
          paddle: {
            currency: 'USD',
            amountMinor: 1200,
            providerPriceId: `pri_${FIXED_KEY}`
          }
        }
      }),
      plans.create({
        key: USAGE_KEY,
        name: 'Usage',
        description: null,
        billingMode: 'usage',
        interval: 'month',
        meterKey: 'api_calls',
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: {
          yookassa: {
            currency: 'RUB',
            amountMinor: 0,
            unitPriceMinor: 200,
            includedUnits: 0
          },
          paddle: {
            currency: 'USD',
            amountMinor: 0,
            unitPriceMinor: 2,
            includedUnits: 0,
            providerPriceId: `pri_${USAGE_KEY}`
          }
        }
      })
    ]);
  }, 30000);

  afterEach(async () => {
    if (customerId) {
      // Invoices hold the customer under RESTRICT, so they go first; the
      // customer, its subscription and its usage then cascade from the user.
      await ds.getRepository(Invoice).delete({ customerId });
      customerId = undefined;
    }
    if (userId) {
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await ds?.getRepository(Plan).delete({ key: FIXED_KEY });
    await ds?.getRepository(Plan).delete({ key: USAGE_KEY });
    await ds?.destroy();
  });

  async function build(providerId: BillingProviderId): Promise<void> {
    provider = fakeProvider(providerId);
    emitted = [];
    const repository = <T extends object>(entity: new () => T) => ({
      provide: getRepositoryToken(entity),
      useValue: ds.getRepository(entity)
    });
    const module = await Test.createTestingModule({
      providers: [
        BillingUserService,
        RenewalService,
        UsageInvoicingService,
        BillingEventReducer,
        CreditService,
        FixedRating,
        UsageRating,
        ProrationCalculator,
        repository(Customer),
        repository(Subscription),
        repository(Invoice),
        repository(PaymentMethod),
        repository(Plan),
        repository(Product),
        repository(User),
        repository(UsageRecord),
        repository(CreditBalance),
        { provide: getDataSourceToken(), useValue: ds },
        { provide: BILLING_PROVIDERS, useValue: [provider] },
        {
          provide: BillingService,
          useValue: { getProviderById: () => provider }
        },
        {
          provide: MetricsService,
          useValue: { recordUnmatchedOffSessionCharge: jest.fn() }
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:4200' }
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: (name: string, payload: unknown) => {
              emitted.push({ name, payload });
              return true;
            }
          }
        }
      ]
    }).compile();
    users = module.get(BillingUserService);
    renewals = module.get(RenewalService);
    invoicing = module.get(UsageInvoicingService);
    reducer = module.get(BillingEventReducer);
  }

  async function seed(
    providerId: BillingProviderId,
    planKey: string
  ): Promise<void> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    providerSubscriptionRef = `sub_${stamp}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `metered-window-${stamp}@example.com`,
        firstName: 'Metered',
        lastName: 'Window',
        password: 'hashed'
      })
    );
    userId = user.id;

    const customer = await ds.getRepository(Customer).save(
      ds.getRepository(Customer).create({
        userId: user.id,
        provider: providerId,
        providerOverride: null,
        providerCustomerId: `cus_${stamp}`,
        country: providerId === 'yookassa' ? 'RU' : 'US',
        currency: providerId === 'yookassa' ? 'RUB' : 'USD',
        defaultPaymentMethodId: null
      })
    );
    customerId = customer.id;

    const selfManaged = providerId === 'yookassa';
    const subscription = await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey,
        provider: providerId,
        billingMode: planKey === USAGE_KEY ? 'usage' : 'fixed',
        status: 'active',
        lifecycleOwner: selfManaged ? 'self' : 'provider',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        billingAnchorAt: selfManaged ? periodStart : null,
        meteredFrom: null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: providerSubscriptionRef,
        paymentMethodId: null,
        version: 1,
        dunningAttempts: 0,
        nextRenewalAttemptAt: null
      })
    );
    subscriptionId = subscription.id;

    // One hundred units, five days before the switch, on the plan in force then.
    await ds.getRepository(UsageRecord).save(
      ds.getRepository(UsageRecord).create({
        customerId: customer.id,
        subscriptionId,
        meterKey: 'api_calls',
        quantity: Money.fromMinor(100),
        occurredAt: new Date(Date.now() - 5 * DAY_MS),
        idempotencyKey: `seed-${stamp}`
      })
    );
  }

  function usageInvoices(): Promise<Invoice[]> {
    return ds.getRepository(Invoice).find({
      where: { subscriptionId, billingMode: 'usage' }
    });
  }

  /** Delivers each close the switch or the webhook published to its listener. */
  async function deliverUsageCloses(): Promise<void> {
    const closes = emitted.filter(
      (e) => e.name === UsagePeriodClosedEvent.name
    );
    emitted = [];
    for (const close of closes) {
      await invoicing.invoiceClosedPeriod(
        close.payload as UsagePeriodClosedEvent
      );
    }
  }

  /** A Paddle snapshot of the next period, on the price of the stored plan. */
  async function rollOverAtProvider(): Promise<void> {
    const { planKey } = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscriptionId });
    await reducer.reduce({
      provider: 'paddle',
      providerEventId: `evt-renew-${subscriptionId}`,
      type: 'subscription.renewed',
      payload: {
        ref: { customerId, userId },
        providerSubscriptionId: providerSubscriptionRef,
        status: 'active',
        providerPriceIds: [`pri_${planKey}`],
        currentPeriodStart: periodEnd.toISOString(),
        currentPeriodEnd: new Date(
          periodEnd.getTime() + 30 * DAY_MS
        ).toISOString(),
        cancelAtPeriodEnd: false,
        trialEnd: null
      }
    });
  }

  /** A Paddle snapshot inside the stored period, on the price of `planKey`. */
  async function planSnapshotAtProvider(planKey: string): Promise<void> {
    await reducer.reduce({
      provider: 'paddle',
      providerEventId: `evt-plan-${subscriptionId}`,
      type: 'subscription.renewed',
      payload: {
        ref: { customerId, userId },
        providerSubscriptionId: providerSubscriptionRef,
        status: 'active',
        providerPriceIds: [`pri_${planKey}`],
        currentPeriodStart: periodStart.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        cancelAtPeriodEnd: false,
        trialEnd: null
      }
    });
  }

  it('YooKassa fixed -> usage: the renewal bills nothing for units consumed on the fixed plan', async () => {
    await build('yookassa');
    await seed('yookassa', FIXED_KEY);

    await users.changePlan(userId as string, USAGE_KEY);
    await renewals.runDueRenewals(afterPeriodEnd);

    const renewal = await ds.getRepository(Invoice).findOneOrFail({
      where: {
        providerEventId: `renewal:${subscriptionId}:${periodEnd.getTime()}`
      }
    });
    expect(renewal.billingMode).toBe('usage');
    expect(renewal.amountMinor.toNumber()).toBe(0);
    expect(provider.chargeOffSession).not.toHaveBeenCalled();
  }, 30000);

  it('YooKassa usage -> fixed: the units are billed at the switch, under the usage plan', async () => {
    await build('yookassa');
    await seed('yookassa', USAGE_KEY);

    await users.changePlan(userId as string, FIXED_KEY);

    const [closing] = await usageInvoices();
    expect(closing).toMatchObject({
      providerEventId: `cancel:${subscriptionId}:${periodStart.getTime()}`,
      status: 'paid'
    });
    expect(closing.amountMinor.toNumber()).toBe(20000);

    await renewals.runDueRenewals(afterPeriodEnd);

    // The renewal prepays the fixed plan and rates no usage a second time.
    expect(await usageInvoices()).toHaveLength(1);
    const renewal = await ds.getRepository(Invoice).findOneOrFail({
      where: {
        providerEventId: `renewal:${subscriptionId}:${periodEnd.getTime()}`
      }
    });
    expect(renewal.billingMode).toBe('fixed');
    expect(renewal.amountMinor.toNumber()).toBe(99000);
    expect(
      (
        await ds.getRepository(Subscription).findOneByOrFail({
          id: subscriptionId
        })
      ).meteredFrom
    ).toBeNull();
  }, 30000);

  it('YooKassa usage -> fixed after the period end: the switch is refused and moves no money', async () => {
    await build('yookassa');
    await seed('yookassa', USAGE_KEY);
    await ds
      .getRepository(Subscription)
      .update(
        { id: subscriptionId },
        { currentPeriodEnd: new Date(Date.now() - 1000) }
      );

    await expect(
      users.changePlan(userId as string, FIXED_KEY)
    ).rejects.toMatchObject({ status: 409 });

    expect(provider.chargeOffSession).not.toHaveBeenCalled();
    expect(await usageInvoices()).toHaveLength(0);
    expect(
      await ds.getRepository(Subscription).findOneByOrFail({
        id: subscriptionId
      })
    ).toMatchObject({ planKey: USAGE_KEY, billingMode: 'usage', version: 1 });
  }, 30000);

  it('Paddle fixed -> usage: the period close bills nothing for units consumed on the fixed plan', async () => {
    await build('paddle');
    await seed('paddle', FIXED_KEY);

    await users.changePlan(userId as string, USAGE_KEY);
    await deliverUsageCloses();
    await rollOverAtProvider();
    await deliverUsageCloses();

    expect(provider.chargeUsage).not.toHaveBeenCalled();
    const [close] = await usageInvoices();
    expect(close).toMatchObject({
      providerEventId: `usage:${subscriptionId}:${periodEnd.getTime()}`,
      status: 'paid'
    });
    expect(close.amountMinor.toNumber()).toBe(0);
  }, 30000);

  it('Paddle usage -> fixed: the units are charged at the switch, under the usage plan', async () => {
    await build('paddle');
    await seed('paddle', USAGE_KEY);

    await users.changePlan(userId as string, FIXED_KEY);
    await deliverUsageCloses();
    await rollOverAtProvider();
    await deliverUsageCloses();

    expect(provider.chargeUsage).toHaveBeenCalledTimes(1);
    expect(provider.chargeUsage).toHaveBeenCalledWith(
      providerSubscriptionRef,
      200,
      'USD',
      expect.any(String),
      expect.stringMatching(new RegExp(`^usage:${subscriptionId}:`))
    );
    const invoices = await usageInvoices();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('pending');
    expect(invoices[0].amountMinor.toNumber()).toBe(200);
  }, 30000);

  it('Paddle usage -> fixed with a missed local write: the snapshot switches the mode and charges the units', async () => {
    await build('paddle');
    await seed('paddle', USAGE_KEY);
    // A webhook that commits during the provider call moves the row off the
    // guard of the local write.
    provider.changePlan.mockImplementation(async () => {
      await ds
        .getRepository(Subscription)
        .update({ id: subscriptionId }, { status: 'past_due' });
    });

    await expect(
      users.changePlan(userId as string, FIXED_KEY)
    ).rejects.toMatchObject({ status: 409 });
    await planSnapshotAtProvider(FIXED_KEY);

    const row = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscriptionId });
    expect(row).toMatchObject({ planKey: FIXED_KEY, billingMode: 'fixed' });
    expect(row.meteredFrom).not.toBeNull();

    await deliverUsageCloses();
    await rollOverAtProvider();
    await deliverUsageCloses();

    expect(provider.chargeUsage).toHaveBeenCalledTimes(1);
    expect(provider.chargeUsage).toHaveBeenCalledWith(
      providerSubscriptionRef,
      200,
      'USD',
      expect.any(String),
      expect.stringMatching(new RegExp(`^usage:${subscriptionId}:`))
    );
    const invoices = await usageInvoices();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].amountMinor.toNumber()).toBe(200);
  }, 30000);

  it('Paddle usage -> fixed whose webhook lands before the local write: the units are charged once', async () => {
    await build('paddle');
    await seed('paddle', USAGE_KEY);
    provider.changePlan.mockImplementation(() =>
      planSnapshotAtProvider(FIXED_KEY)
    );

    await expect(
      users.changePlan(userId as string, FIXED_KEY)
    ).rejects.toMatchObject({ status: 409 });
    await deliverUsageCloses();
    await rollOverAtProvider();
    await deliverUsageCloses();

    expect(provider.chargeUsage).toHaveBeenCalledTimes(1);
    const invoices = await usageInvoices();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].amountMinor.toNumber()).toBe(200);
    expect(
      await ds.getRepository(Subscription).findOneByOrFail({
        id: subscriptionId
      })
    ).toMatchObject({ planKey: FIXED_KEY, billingMode: 'fixed' });
  }, 30000);
});
