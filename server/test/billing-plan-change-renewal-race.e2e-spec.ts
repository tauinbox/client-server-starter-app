// A self-managed plan change that starts before the renewal anchor can still be
// in flight when the anchor passes and the renewal scan runs. Real services on
// a real PostgreSQL; the provider is a fake whose first call under a chosen key
// prefix waits past the anchor and runs the scan, where the window is.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import {
  BILLING_PROVIDERS,
  ChargeDeclinedError,
  type ChargeResult,
  type PaymentProvider
} from '../src/modules/billing/providers/payment-provider.interface';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { ProrationCalculator } from '../src/modules/billing/rating/proration-calculator';
import { PLAN_CHANGE_LEASE_MS } from '../src/modules/billing/renewals/renewal-queue.constants';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { PlanChangeService } from '../src/modules/billing/services/plan-change.service';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY_MS = 86_400_000;
const FROM_KEY = 'renewal-race-basic';
const FIXED_KEY = 'renewal-race-fixed';
const FROM_PRICE = 49000;
const FIXED_PRICE = 99000;
// Long enough for the change to read the row and pass its guards first.
const ANCHOR_DELAY_MS = 1500;

type FakeProvider = PaymentProvider & { chargeOffSession: jest.Mock };

function fakeProvider(): FakeProvider {
  return {
    id: 'yookassa',
    managesLifecycle: false,
    startCheckout: jest.fn(),
    chargeOffSession: jest.fn(),
    findOffSessionCharge: jest.fn().mockResolvedValue(null),
    getOffSessionCharge: jest.fn().mockResolvedValue(null),
    createOneTimePayment: jest.fn(),
    changePlan: jest.fn(),
    previewChangePlan: jest.fn(),
    updatePaymentMethod: jest.fn(),
    cancel: jest.fn(),
    refund: jest.fn().mockResolvedValue(undefined),
    verifyAndParseWebhook: jest.fn()
  };
}

async function waitPast(moment: Date): Promise<void> {
  const remaining = moment.getTime() - Date.now() + 50;

  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

runWithInfra('Plan change vs. the renewal scan across the anchor (e2e)', () => {
  let ds: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let userId: string | undefined;
  let customerId: string | undefined;
  let subscriptionId: string;
  let periodEnd: Date;
  let provider: FakeProvider;
  let planChange: PlanChangeService;
  let renewals: RenewalService;
  /** Idempotency key and amount of every charge the provider was asked for. */
  let charges: Array<{ key: string; amount: number }>;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    releaseDbLock = await holdBillingDbLock(ds);
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
        prices: { yookassa: { currency: 'RUB', amountMinor: FIXED_PRICE } }
      }),
      plans.create({
        key: FROM_KEY,
        name: 'Basic',
        description: null,
        billingMode: 'fixed',
        interval: 'month',
        meterKey: null,
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: { yookassa: { currency: 'RUB', amountMinor: FROM_PRICE } }
      })
    ]);
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  afterEach(async () => {
    jest.restoreAllMocks();

    if (customerId) {
      // Invoices hold the customer under RESTRICT, so they go first; the
      // customer and its subscription then cascade from the user.
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
    await ds?.getRepository(Plan).delete({ key: FROM_KEY });
    await releaseDbLock?.();
    await ds?.destroy();
  });

  async function build(): Promise<void> {
    provider = fakeProvider();
    charges = [];
    const repository = <T extends object>(entity: new () => T) => ({
      provide: getRepositoryToken(entity),
      useValue: ds.getRepository(entity)
    });
    const module = await Test.createTestingModule({
      providers: [
        PlanChangeService,
        RenewalService,
        FixedRating,
        ProrationCalculator,
        repository(Customer),
        repository(Subscription),
        repository(Invoice),
        repository(PaymentMethod),
        repository(Plan),
        repository(Product),
        repository(User),
        { provide: getDataSourceToken(), useValue: ds },
        { provide: BILLING_PROVIDERS, useValue: [provider] },
        {
          provide: BillingService,
          useValue: { getProviderById: () => provider }
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:4200' }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
      ]
    }).compile();

    planChange = module.get(PlanChangeService);
    renewals = module.get(RenewalService);
  }

  /** A subscription on the cheaper plan whose period ends shortly. */
  async function seed(): Promise<void> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `renewal-race-${stamp}@example.com`,
        name: 'Renewal Race',
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

    const periodStart = new Date(Date.now() - 30 * DAY_MS);

    periodEnd = new Date(Date.now() + ANCHOR_DELAY_MS);
    const subscription = await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey: FROM_KEY,
        provider: 'yookassa',
        billingMode: 'fixed',
        status: 'active',
        lifecycleOwner: 'self',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        billingAnchorAt: periodStart,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: null,
        paymentMethodId: null,
        version: 1,
        dunningAttempts: 0,
        nextRenewalAttemptAt: null
      })
    );

    subscriptionId = subscription.id;
  }

  /** Records every charge and captures it once `onCharge` settles. */
  function answerCharges(onCharge: (key: string) => Promise<void>): void {
    provider.chargeOffSession.mockImplementation(
      async (
        ...[, { amountMinor: amount, idempotencyKey: key = '' }]: Parameters<
          PaymentProvider['chargeOffSession']
        >
      ): Promise<ChargeResult> => {
        charges.push({ key, amount });
        await onCharge(key);

        return { providerInvoiceRef: `pay_${key}`, status: 'captured' };
      }
    );
  }

  /**
   * The first charge whose key starts with `prefix` runs `during` before it
   * answers, which is the provider round-trip window.
   */
  function gateOn(prefix: string, during: () => Promise<void>): void {
    let fired = false;

    answerCharges(async (key) => {
      if (!fired && key.startsWith(prefix)) {
        fired = true;
        await during();
      }
    });
  }

  /** The scan an hourly tick runs once the anchor has passed. */
  async function scanPastAnchor(): Promise<void> {
    await waitPast(periodEnd);
    await renewals.runDueRenewals();
  }

  function row(): Promise<Subscription> {
    return ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscriptionId });
  }

  function invoices(): Promise<Invoice[]> {
    return ds
      .getRepository(Invoice)
      .find({ where: { subscriptionId }, order: { createdAt: 'ASC' } });
  }

  function chargedPrefixes(): string[] {
    return charges.map((c) => c.key.split(':')[0]);
  }

  /**
   * The new plan prepays the period the scan opens after the change: one
   * renewal, at the full price of the new plan.
   */
  async function expectSwitchThenRenewal(): Promise<void> {
    expect(chargedPrefixes()).toEqual(['change-charge', 'renewal']);

    const renewal = await ds.getRepository(Invoice).findOneByOrFail({
      providerEventId: `renewal:${subscriptionId}:${periodEnd.getTime()}`
    });

    expect(renewal).toMatchObject({ billingMode: 'fixed', status: 'paid' });
    expect(renewal.amountMinor.toNumber()).toBe(FIXED_PRICE);
    expect(renewal.periodStart).toEqual(periodEnd);

    const current = await row();

    expect(current).toMatchObject({ planKey: FIXED_KEY, billingMode: 'fixed' });
    expect(current.currentPeriodStart).toEqual(periodEnd);
    expect(current.planChangeStartedAt).toBeNull();
  }

  it('a scan during the proration charge leaves the row to the change', async () => {
    await build();
    await seed();
    gateOn('change-charge:', scanPastAnchor);

    await planChange.changePlan(userId as string, FIXED_KEY);
    await renewals.runDueRenewals();

    await expectSwitchThenRenewal();
  }, 30000);

  it('a change that reaches its claim after the anchor is refused before any money moves', async () => {
    await build();
    await seed();
    gateOn('', () => Promise.resolve());
    // The change passes its entry guard before the anchor, and the plan lookup
    // that follows it returns after the anchor: by the claim, the scan owns it.
    const plans = ds.getRepository(Plan);
    const findPlan = plans.findOne.bind(plans);

    jest.spyOn(plans, 'findOne').mockImplementation(async (options) => {
      await waitPast(periodEnd);

      return findPlan(options);
    });

    await expect(
      planChange.changePlan(userId as string, FIXED_KEY)
    ).rejects.toMatchObject({ status: 409 });

    expect(charges).toHaveLength(0);
    expect(await invoices()).toHaveLength(0);
    expect(await row()).toMatchObject({
      planKey: FROM_KEY,
      version: 1,
      planChangeStartedAt: null
    });
  }, 30000);

  it('a scan past an expired lease renews, and the change it overtook is refused', async () => {
    await build();
    await seed();
    gateOn('change-charge:', async () => {
      // A change stuck past its lease: the scan is free to take the period.
      await ds.getRepository(Subscription).update(
        { id: subscriptionId },
        {
          planChangeStartedAt: new Date(
            Date.now() - PLAN_CHANGE_LEASE_MS - 1000
          )
        }
      );
      await scanPastAnchor();
    });

    await expect(
      planChange.changePlan(userId as string, FIXED_KEY)
    ).rejects.toMatchObject({ status: 409 });

    // The renewal charges the plan the row still carries. Both legs of the
    // refused change stay recorded, as for every guard miss: the proration
    // charge, and the refund leg, whose source is the renewal invoice that the
    // scan paid while the change waited.
    expect(chargedPrefixes()).toEqual(['change-charge', 'renewal']);
    const all = await invoices();

    expect(
      all.map((i) => [i.providerEventId?.split(':')[0], i.status])
    ).toEqual([
      ['change-charge', 'paid'],
      ['renewal', 'paid'],
      ['change-refund', 'refunded']
    ]);
    const [, renewal, refund] = all;

    expect(renewal.refundedMinor.toNumber()).toBe(
      refund.amountMinor.toNumber()
    );
    const current = await row();

    expect(current.planKey).toBe(FROM_KEY);
    expect(current.currentPeriodStart).toEqual(periodEnd);
  }, 30000);

  it('a declined proration charge releases the row for the renewal', async () => {
    await build();
    await seed();
    answerCharges((key) =>
      key.startsWith('change-charge:')
        ? Promise.reject(new ChargeDeclinedError())
        : Promise.resolve()
    );

    await expect(
      planChange.changePlan(userId as string, FIXED_KEY)
    ).rejects.toBeInstanceOf(ChargeDeclinedError);
    expect((await row()).planChangeStartedAt).toBeNull();

    await scanPastAnchor();

    expect(chargedPrefixes()).toEqual(['change-charge', 'renewal']);
    const renewal = await ds.getRepository(Invoice).findOneByOrFail({
      providerEventId: `renewal:${subscriptionId}:${periodEnd.getTime()}`
    });

    expect(renewal.amountMinor.toNumber()).toBe(FROM_PRICE);
  }, 30000);

  it('a change claims a row whose lease a dead change left behind', async () => {
    await build();
    await seed();
    answerCharges(() => Promise.resolve());
    await ds.getRepository(Subscription).update(
      { id: subscriptionId },
      {
        planChangeStartedAt: new Date(Date.now() - PLAN_CHANGE_LEASE_MS - 1000)
      }
    );

    await planChange.changePlan(userId as string, FIXED_KEY);

    expect(await row()).toMatchObject({
      planKey: FIXED_KEY,
      planChangeStartedAt: null
    });
  }, 30000);

  it('a second change while the first is in flight is refused before it charges', async () => {
    await build();
    await seed();
    gateOn('change-charge:', async () => {
      await expect(
        planChange.changePlan(userId as string, FIXED_KEY)
      ).rejects.toMatchObject({ status: 409 });
    });

    await planChange.changePlan(userId as string, FIXED_KEY);

    expect(chargedPrefixes()).toEqual(['change-charge']);
    expect(await row()).toMatchObject({
      planKey: FIXED_KEY,
      planChangeStartedAt: null
    });
  }, 30000);
});
