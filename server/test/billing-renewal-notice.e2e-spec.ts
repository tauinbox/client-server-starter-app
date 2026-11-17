// The renewal notice scan on a real PostgreSQL: which self-managed rows get a
// notice, and that the marker column lets one notice through per period, also
// for a repeated scan and for two scans that run at the same time.

import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { RenewalUpcomingEvent } from '../src/modules/billing/events/billing.events';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { RenewalNoticeService } from '../src/modules/billing/renewals/renewal-notice.service';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';
import { waitsOnLock } from './lock-wait';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY_MS = 86_400_000;
const PAID_KEY = 'renewal-notice-paid';
const FREE_KEY = 'renewal-notice-free';
const PAID_PRICE = 99000;

runWithInfra('Renewal notice scan (e2e)', () => {
  let ds: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let notices: RenewalNoticeService;
  let emit: jest.Mock;
  const userIds: string[] = [];

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    releaseDbLock = await holdBillingDbLock(ds);
    const plans = ds.getRepository(Plan);

    await plans.save(
      [
        { key: PAID_KEY, name: 'Notice Pro', amountMinor: PAID_PRICE },
        { key: FREE_KEY, name: 'Notice Free', amountMinor: 0 }
      ].map(({ key, name, amountMinor }) =>
        plans.create({
          key,
          name,
          description: null,
          billingMode: 'fixed',
          interval: 'month',
          entitlements: [],
          limits: null,
          trialDays: 0,
          active: true,
          prices: { yookassa: { currency: 'RUB', amountMinor } }
        })
      )
    );

    emit = jest.fn();
    const repository = <T extends object>(entity: new () => T) => ({
      provide: getRepositoryToken(entity),
      useValue: ds.getRepository(entity)
    });
    const module = await Test.createTestingModule({
      providers: [
        RenewalNoticeService,
        FixedRating,
        repository(Subscription),
        repository(Customer),
        repository(Plan),
        { provide: getDataSourceToken(), useValue: ds },
        { provide: EventEmitter2, useValue: { emit } }
      ]
    }).compile();

    notices = module.get(RenewalNoticeService);
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  afterEach(async () => {
    emit.mockClear();

    // The customer and its subscriptions cascade from the user.
    for (const id of userIds.splice(0)) {
      await ds.getRepository(User).delete({ id });
    }
  });

  afterAll(async () => {
    await ds?.getRepository(Plan).delete({ key: PAID_KEY });
    await ds?.getRepository(Plan).delete({ key: FREE_KEY });
    await releaseDbLock?.();
    await ds?.destroy();
  });

  async function seed(
    overrides: Partial<Subscription> = {},
    { deleted = false }: { deleted?: boolean } = {}
  ): Promise<Subscription> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const users = ds.getRepository(User);
    const user = await users.save(
      users.create({
        email: `renewal-notice-${stamp}@example.com`,
        name: 'Renewal Notice',
        password: 'hashed'
      })
    );

    userIds.push(user.id);

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
    const periodStart = new Date(Date.now() - 28 * DAY_MS);
    const subscription = await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey: PAID_KEY,
        provider: 'yookassa',
        billingMode: 'fixed',
        status: 'active',
        lifecycleOwner: 'self',
        currentPeriodStart: periodStart,
        currentPeriodEnd: new Date(Date.now() + 2 * DAY_MS),
        billingAnchorAt: periodStart,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: null,
        paymentMethodId: null,
        version: 1,
        dunningAttempts: 0,
        nextRenewalAttemptAt: null,
        ...overrides
      })
    );

    if (deleted) await users.softDelete({ id: user.id });

    return subscription;
  }

  /** The renewal events that the scan emitted for the given rows. */
  function emitted(...subscriptions: Subscription[]): RenewalUpcomingEvent[] {
    const ids = new Set(subscriptions.map(({ id }) => id));

    return emit.mock.calls
      .filter(([name]) => name === RenewalUpcomingEvent.name)
      .map(([, event]) => event as RenewalUpcomingEvent)
      .filter(({ subscriptionId }) => ids.has(subscriptionId));
  }

  it('sends one notice with the date and the amount of the charge, and none on a second scan', async () => {
    const subscription = await seed();
    const customer = await ds
      .getRepository(Customer)
      .findOneByOrFail({ id: subscription.customerId });

    await notices.sendRenewalNotices();
    await notices.sendRenewalNotices();

    const events = emitted(subscription);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      new RenewalUpcomingEvent(customer.userId, subscription.id, {
        renewsAt: subscription.currentPeriodEnd,
        amount: { amountMinor: PAID_PRICE, currency: 'RUB' }
      })
    );

    const stored = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscription.id });

    expect(stored.renewalNoticeFor).toEqual(subscription.currentPeriodEnd);
  });

  it('sends one notice when two scans claim the row at the same time', async () => {
    const subscription = await seed();
    const holder = ds.createQueryRunner();

    await holder.connect();
    await holder.startTransaction();

    try {
      // Both scans select the row as unclaimed, then wait on its lock.
      await holder.query(
        'SELECT id FROM subscriptions WHERE id = $1 FOR UPDATE',
        [subscription.id]
      );
      const scans = Promise.all([
        notices.sendRenewalNotices(),
        notices.sendRenewalNotices()
      ]);

      expect(await waitsOnLock(ds, '%renewal_notice_for%', 2)).toBe(true);
      await holder.rollbackTransaction();
      await scans;
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();

      await holder.release();
    }

    expect(emitted(subscription)).toHaveLength(1);
  });

  it('notices a trial at its trial end, and the first paid period again', async () => {
    const trialEnd = new Date(Date.now() + DAY_MS);
    const subscription = await seed({
      status: 'trialing',
      trialEnd,
      currentPeriodEnd: trialEnd
    });

    await notices.sendRenewalNotices();

    expect(emitted(subscription).map((e) => e.renewal.renewsAt)).toEqual([
      trialEnd
    ]);

    // The trial converts; the next boundary is a month later and outside
    // the lead, so the scan sends nothing until that boundary comes near.
    const nextEnd = new Date(trialEnd.getTime() + 30 * DAY_MS);

    await ds.getRepository(Subscription).update(
      { id: subscription.id },
      {
        status: 'active',
        trialEnd: null,
        currentPeriodStart: trialEnd,
        currentPeriodEnd: nextEnd
      }
    );
    emit.mockClear();
    await notices.sendRenewalNotices();

    expect(emitted(subscription)).toHaveLength(0);

    await notices.sendRenewalNotices(new Date(nextEnd.getTime() - DAY_MS));

    expect(emitted(subscription).map((e) => e.renewal.renewsAt)).toEqual([
      nextEnd
    ]);
  });

  it('sends nothing for a row that is not charged inside the lead', async () => {
    const skipped = await Promise.all([
      seed({ currentPeriodEnd: new Date(Date.now() + 4 * DAY_MS) }),
      seed({ currentPeriodEnd: new Date(Date.now() - DAY_MS) }),
      seed({ cancelAtPeriodEnd: true }),
      seed({ lifecycleOwner: 'provider' }),
      seed({ status: 'past_due' }),
      seed({ status: 'canceled' }),
      seed({}, { deleted: true })
    ]);

    await notices.sendRenewalNotices();

    expect(emitted(...skipped)).toHaveLength(0);

    const markers = await ds
      .getRepository(Subscription)
      .findBy(skipped.map(({ id }) => ({ id })));

    expect(markers.map((s) => s.renewalNoticeFor)).toEqual(
      skipped.map(() => null)
    );
  });

  it('claims a free period without a notice, so a later scan does not read it again', async () => {
    const subscription = await seed({ planKey: FREE_KEY });

    await notices.sendRenewalNotices();

    expect(emitted(subscription)).toHaveLength(0);

    const stored = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscription.id });

    expect(stored.renewalNoticeFor).toEqual(subscription.currentPeriodEnd);
  });
});
