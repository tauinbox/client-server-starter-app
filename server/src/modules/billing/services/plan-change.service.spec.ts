import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { In, Not } from 'typeorm';
import type { FindOperator } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { ErrorKeys } from '@app/shared/constants';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PlanChangedEvent,
  UsagePeriodClosedEvent
} from '../events/billing.events';
import { RenewalService } from '../renewals/renewal.service';
import { BillingService } from '../billing.service';
import { ProrationCalculator } from '../rating/proration-calculator';
import { ChargeDeclinedError } from '../providers/payment-provider.interface';
import { ProviderTimeoutError } from '../providers/provider-deadline';
import {
  expectRefusal,
  makePlan,
  provider,
  repo,
  type RepoMock
} from '../testing/billing-service.fixtures';
import { PlanChangeService } from './plan-change.service';

type InsertedInvoice = Record<string, unknown> & {
  providerEventId?: string | null;
  status?: string;
};

type InvoiceCriteria = {
  id?: string;
  providerEventId?: string;
  status?: string | FindOperator<string>;
};

/** Matches a stored row's status against a plain value or an `In([...])`. */
function statusMatches(
  row: InsertedInvoice,
  expected: InvoiceCriteria['status']
): boolean {
  if (expected === undefined) return true;
  if (typeof expected === 'string') return row.status === expected;
  const allowed: string[] = Array.isArray(expected.value)
    ? expected.value
    : [expected.value];
  return allowed.includes(row.status ?? '');
}

/**
 * Transactional manager stub: records invoice inserts, dedups on event id, and
 * applies invoice updates to the stored rows so a plant-then-settle sequence is
 * observable as the row's final state (the charge leg is now recorded before
 * the provider call and settled afterwards, not inserted once at the end).
 */
function makeInsertStore(invoices: RepoMock) {
  const inserted: InsertedInvoice[] = [];
  let seq = 0;
  const applyInvoiceUpdate = (
    criteria: InvoiceCriteria,
    patch: Record<string, unknown>
  ): { affected: number } => {
    const matched = inserted.filter(
      (row) =>
        (criteria.id === undefined || row['id'] === criteria.id) &&
        (criteria.providerEventId === undefined ||
          row.providerEventId === criteria.providerEventId) &&
        statusMatches(row, criteria.status)
    );
    for (const row of matched) {
      Object.assign(row, patch);
    }
    return { affected: matched.length };
  };
  invoices.update = jest.fn(
    (criteria: InvoiceCriteria, patch: Record<string, unknown>) =>
      Promise.resolve(applyInvoiceUpdate(criteria, patch))
  );
  const manager = {
    // changePlan applies the plan and bumps the refund source within the tx.
    save: (_target: unknown, entity: { id?: string }) =>
      Promise.resolve({ id: 'generated-id', ...entity }),
    update: jest.fn(
      (
        target: unknown,
        criteria: InvoiceCriteria,
        patch: Record<string, unknown>
      ) =>
        Promise.resolve(
          target === Invoice
            ? applyInvoiceUpdate(criteria, patch)
            : { affected: 1 }
        )
    ),
    // The proration refund reserves its leg on the source invoice under a row
    // lock, so that read goes through the transactional manager. A read by
    // event id looks for a leg row this store recorded.
    findOne: jest.fn(
      (
        entity: unknown,
        options: { where?: InvoiceCriteria }
      ): Promise<unknown> => {
        if (entity !== Invoice) return Promise.resolve(null);
        const eventId = options.where?.providerEventId;
        if (eventId !== undefined) {
          return Promise.resolve(
            inserted.find((row) => row.providerEventId === eventId) ?? null
          );
        }
        return invoices.findOne(options) as Promise<unknown>;
      }
    ),
    delete: jest.fn((_target: unknown, criteria: InvoiceCriteria) => {
      const kept = inserted.filter(
        (row) =>
          row.providerEventId !== criteria.providerEventId ||
          !statusMatches(row, criteria.status)
      );
      const affected = inserted.length - kept.length;
      inserted.splice(0, inserted.length, ...kept);
      return Promise.resolve({ affected });
    }),
    createQueryBuilder: () => {
      const captured: { values?: InsertedInvoice } = {};
      const builder = {
        insert: () => builder,
        into: () => builder,
        values: (v: InsertedInvoice) => {
          captured.values = v;
          return builder;
        },
        orIgnore: () => builder,
        returning: () => builder,
        execute: () => {
          const v = captured.values ?? {};
          const dup = inserted.some(
            (i) => i.providerEventId === v.providerEventId
          );
          if (dup) return Promise.resolve({ raw: [] });
          const id = `inv-${++seq}`;
          inserted.push({ id, ...v });
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    }
  };
  /**
   * A thrown callback rolls the transaction back, so the stub has to undo the
   * rows it recorded inside it - without this a probe for "what survives a
   * crash mid-transaction" would see writes a real database discards.
   */
  const snapshot = (): InsertedInvoice[] => inserted.map((row) => ({ ...row }));
  const restore = (rows: InsertedInvoice[]): void => {
    inserted.splice(0, inserted.length, ...rows);
  };
  return { inserted, manager, snapshot, restore };
}

async function build() {
  const customers = repo();
  const subscriptions = repo();
  const invoices = repo();
  const plans = repo();
  const emit = jest.fn();

  const renewals = { billClosingUsagePeriod: jest.fn() };
  const billing = { getProviderById: jest.fn() };

  const insertStore = makeInsertStore(invoices);
  const dataSource = {
    manager: insertStore.manager,
    transaction: jest.fn(async (cb: (m: unknown) => unknown) => {
      const before = insertStore.snapshot();
      try {
        return await cb(insertStore.manager);
      } catch (error) {
        insertStore.restore(before);
        throw error;
      }
    })
  };

  const module = await Test.createTestingModule({
    providers: [
      PlanChangeService,
      ProrationCalculator,
      { provide: getRepositoryToken(Customer), useValue: customers },
      { provide: getRepositoryToken(Subscription), useValue: subscriptions },
      { provide: getRepositoryToken(Invoice), useValue: invoices },
      { provide: getRepositoryToken(Plan), useValue: plans },
      { provide: getDataSourceToken(), useValue: dataSource },
      { provide: BillingService, useValue: billing },
      { provide: RenewalService, useValue: renewals },
      { provide: EventEmitter2, useValue: { emit } }
    ]
  }).compile();

  return {
    service: module.get(PlanChangeService),
    customers,
    subscriptions,
    invoices,
    plans,
    billing,
    renewals,
    emit,
    dataSource,
    insertedInvoices: insertStore.inserted
  };
}

describe('PlanChangeService', () => {
  describe('changePlan', () => {
    const customer = {
      id: 'cust-1',
      userId: 'user-1',
      country: 'RU',
      currency: 'RUB',
      providerOverride: null
    };
    // 30-day period; the frozen "now" leaves exactly 12 whole days remaining.
    const periodStart = new Date('2026-06-01T00:00:00Z');
    const periodEnd = new Date('2026-07-01T00:00:00Z');
    const frozenNow = new Date('2026-06-19T00:00:00Z');

    const proPlan = makePlan();
    const businessPlan = makePlan({
      id: 'plan-business',
      key: 'business',
      name: 'Business',
      prices: {
        yookassa: { currency: 'RUB', amountMinor: 290000 },
        paddle: {
          currency: 'USD',
          amountMinor: 2900,
          providerPriceId: 'pri_biz'
        }
      }
    });
    const usagePlan = makePlan({
      id: 'plan-usage',
      key: 'usage',
      name: 'Pay as you go',
      billingMode: 'usage',
      meterKey: 'api_calls',
      prices: {
        yookassa: {
          currency: 'RUB',
          amountMinor: 0,
          unitPriceMinor: 200,
          includedUnits: 0
        }
      }
    });

    function makeSub(overrides: Partial<Subscription> = {}): Subscription {
      return {
        id: 'sub-1',
        customerId: 'cust-1',
        planKey: 'pro',
        provider: 'yookassa',
        billingMode: 'fixed',
        status: 'active',
        lifecycleOwner: 'self',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: null,
        version: 1,
        planChangeSeq: 0,
        ...overrides
      } as Subscription;
    }

    function plansByKey(ctx: Awaited<ReturnType<typeof build>>): void {
      const byKey: Record<string, Plan> = {
        pro: proPlan,
        business: businessPlan,
        usage: usagePlan
      };
      ctx.plans.findOne.mockImplementation((opts: { where: { key: string } }) =>
        Promise.resolve(byKey[opts.where.key] ?? null)
      );
    }

    beforeEach(() => {
      jest.useFakeTimers({ now: frozenNow, doNotFake: ['nextTick'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it.each([
      [
        'a period past its end',
        { currentPeriodEnd: new Date('2026-06-18T00:00:00Z') }
      ],
      [
        'a trial past its end',
        {
          status: 'trialing' as const,
          trialEnd: new Date('2026-06-19T00:00:00Z')
        }
      ]
    ])(
      'refuses a self-managed change on %s, before any money moves',
      async (_case, overrides) => {
        const ctx = await build();
        plansByKey(ctx);
        ctx.customers.findOne.mockResolvedValue(customer);
        ctx.subscriptions.findOne.mockResolvedValue(
          makeSub({ planKey: 'usage', billingMode: 'usage', ...overrides })
        );
        const yoo = provider('yookassa', false);
        ctx.billing.getProviderById.mockReturnValue(yoo);
        const message =
          'The billing period has ended and its renewal is in progress. Try again shortly.';

        await expect(ctx.service.changePlan('user-1', 'pro')).rejects.toThrow(
          new ConflictException(message)
        );
        await expect(
          ctx.service.previewChange('user-1', 'pro')
        ).rejects.toThrow(new ConflictException(message));
        await expectRefusal(
          ctx.service.changePlan('user-1', 'pro'),
          ConflictException,
          ErrorKeys.BILLING.RENEWAL_IN_PROGRESS
        );

        expect(ctx.subscriptions.update).not.toHaveBeenCalled();
        expect(ctx.renewals.billClosingUsagePeriod).not.toHaveBeenCalled();
        expect(yoo.chargeOffSession).not.toHaveBeenCalled();
      }
    );

    it('lets a provider-managed row change after its local period end', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({
          provider: 'paddle',
          lifecycleOwner: 'provider',
          providerSubscriptionId: 'sub_ext',
          currentPeriodEnd: new Date('2026-06-18T00:00:00Z')
        })
      );
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      const result = await ctx.service.changePlan('user-1', 'business');

      expect(result.planKey).toBe('business');
    });

    it('delegates a provider-managed change to the provider and updates the local row', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      const sub = makeSub({
        provider: 'paddle',
        lifecycleOwner: 'provider',
        providerSubscriptionId: 'sub_ext'
      });
      ctx.subscriptions.findOne.mockResolvedValue(sub);
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      const result = await ctx.service.changePlan('user-1', 'business');

      expect(paddle.changePlan).toHaveBeenCalledWith(
        'sub_ext',
        expect.objectContaining({ id: 'cust-1' }),
        businessPlan
      );
      expect(paddle.chargeOffSession).not.toHaveBeenCalled();
      expect(paddle.refund).not.toHaveBeenCalled();
      expect(result.planKey).toBe('business');
      expect(ctx.emit).toHaveBeenCalledWith(
        PlanChangedEvent.name,
        expect.objectContaining({
          userId: 'user-1',
          subscriptionId: 'sub-1',
          fromPlanKey: 'pro',
          toPlanKey: 'business'
        })
      );
      expect(ctx.insertedInvoices).toHaveLength(0);
    });

    it('upgrade (self-managed): charges the prorated difference, then refunds the remainder', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(0),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'business');

      // 12 of 30 days: charge 290000*12/30, refund 99000*12/30.
      expect(yoo.chargeOffSession).toHaveBeenCalledWith(
        customer,
        116000,
        'RUB',
        expect.arrayContaining([
          expect.objectContaining({ amountMinor: 116000 })
        ]),
        'change-charge:sub-1:0:business'
      );
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        39600,
        'change-refund:sub-1:0'
      );
      expect(ctx.insertedInvoices).toHaveLength(2);
      expect(ctx.insertedInvoices[0]).toMatchObject({
        amountMinor: Money.fromMinor(116000),
        status: 'paid',
        billingMode: 'fixed'
      });
      expect(ctx.insertedInvoices[1]).toMatchObject({
        amountMinor: Money.fromMinor(39600),
        status: 'refunded'
      });
      // A partial refund leaves the source paid, so the admin can refund the rest.
      expect(ctx.dataSource.manager.update).not.toHaveBeenCalledWith(
        Invoice,
        expect.objectContaining({ id: 'inv-period' }),
        expect.anything()
      );
      expect(result.planKey).toBe('business');
      expect(ctx.emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1' })
      );
      expect(ctx.emit).toHaveBeenCalledWith(
        PlanChangedEvent.name,
        expect.objectContaining({ fromPlanKey: 'pro', toPlanKey: 'business' })
      );
    });

    it('records an uncaptured proration charge as pending and defers InvoicePaid to the webhook', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockResolvedValue({
        providerInvoiceRef: 'pay_change',
        status: 'pending'
      });
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'business');

      // Funds are not captured yet: the invoice must not read as paid, and the
      // paid event must wait for the confirming webhook.
      expect(ctx.insertedInvoices[0]).toMatchObject({
        amountMinor: Money.fromMinor(116000),
        status: 'pending',
        paidAt: null
      });
      expect(
        ctx.emit.mock.calls.filter(
          (call: unknown[]) => call[0] === InvoicePaidEvent.name
        )
      ).toHaveLength(0);
      // The switch itself still applies.
      expect(result.planKey).toBe('business');
      expect(ctx.emit).toHaveBeenCalledWith(
        PlanChangedEvent.name,
        expect.objectContaining({ toPlanKey: 'business' })
      );
    });

    it('downgrade caps the refund at the original invoice amount', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planKey: 'business' })
      );
      // The period was paid with a discounted 100000 invoice — smaller than the
      // computed 116000 remainder, so the cap applies.
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(100000),
        refundedMinor: Money.fromMinor(0),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'pro');

      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        100000,
        expect.any(String)
      );
      // Refunded in full: the source leaves `paid`, so no admin refund is offered.
      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Invoice,
        { id: 'inv-period', status: 'paid' },
        { status: 'refunded' }
      );
      expect(yoo.chargeOffSession).toHaveBeenCalledWith(
        customer,
        39600,
        'RUB',
        expect.any(Array),
        expect.any(String)
      );
    });

    it('charges and records both legs in the currency of the price, not the locale currency of the customer', async () => {
      const ctx = await build();
      plansByKey(ctx);
      // A non-Russian locale that chose the region "Russia": USD on the
      // customer row, RUB on every YooKassa price.
      ctx.customers.findOne.mockResolvedValue({
        ...customer,
        country: 'US',
        currency: 'USD',
        providerOverride: 'yookassa'
      });
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(0),
        currency: 'RUB',
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'business');

      expect(yoo.chargeOffSession).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD' }),
        116000,
        'RUB',
        expect.any(Array),
        expect.any(String)
      );
      expect(ctx.insertedInvoices).toHaveLength(2);
      expect(ctx.insertedInvoices[0]).toMatchObject({
        status: 'paid',
        currency: 'RUB'
      });
      expect(ctx.insertedInvoices[1]).toMatchObject({
        status: 'refunded',
        currency: 'RUB'
      });
    });

    it('previews a trial switch in the currency of the target price', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({
        ...customer,
        currency: 'USD'
      });
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ status: 'trialing' })
      );
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const preview = await ctx.service.previewChange('user-1', 'business');

      expect(preview).toMatchObject({ currency: 'RUB', dueNowMinor: 0 });
    });

    it('fixed → usage refunds the remainder without charging', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      const sub = makeSub();
      ctx.subscriptions.findOne.mockResolvedValue(sub);
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(0),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'usage');

      expect(yoo.chargeOffSession).not.toHaveBeenCalled();
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        39600,
        expect.any(String)
      );
      expect(result.billingMode).toBe('usage');
    });

    it('fixed → usage starts the metered window at the switch and bills nothing for it', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const result = await ctx.service.changePlan('user-1', 'usage');

      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ id: 'sub-1' }),
        {
          planKey: 'usage',
          billingMode: 'usage',
          planChangeSeq: expect.any(Function) as unknown,
          meteredFrom: frozenNow
        }
      );
      expect(result.meteredFrom).toEqual(frozenNow);
      expect(ctx.renewals.billClosingUsagePeriod).not.toHaveBeenCalled();
    });

    it('usage → fixed bills the closing window under the outgoing plan, then moves it', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planKey: 'usage', billingMode: 'usage' })
      );
      const planAtClose: string[] = [];
      ctx.renewals.billClosingUsagePeriod.mockImplementation(
        (sub: Subscription) => {
          planAtClose.push(sub.planKey);
          return Promise.resolve();
        }
      );
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'pro');

      expect(ctx.renewals.billClosingUsagePeriod).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub-1' }),
        frozenNow
      );
      expect(planAtClose).toEqual(['usage']);
      expect(ctx.subscriptions.update).toHaveBeenCalledWith(
        { id: 'sub-1' },
        { meteredFrom: frozenNow }
      );
      expect(result).toMatchObject({ planKey: 'pro', billingMode: 'fixed' });
    });

    it('usage → fixed bills nothing when the prorated charge is declined', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planKey: 'usage', billingMode: 'usage' })
      );
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockRejectedValue(new Error('declined'));
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(ctx.service.changePlan('user-1', 'pro')).rejects.toThrow(
        'declined'
      );

      expect(ctx.renewals.billClosingUsagePeriod).not.toHaveBeenCalled();
    });

    it('usage → fixed on a provider-managed row closes the window with the outgoing plan', async () => {
      const ctx = await build();
      const paddleUsage = makePlan({
        ...usagePlan,
        prices: {
          paddle: {
            currency: 'USD',
            amountMinor: 0,
            unitPriceMinor: 2,
            providerPriceId: 'pri_usage'
          }
        }
      });
      ctx.plans.findOne.mockImplementation((opts: { where: { key: string } }) =>
        Promise.resolve(
          opts.where.key === 'usage'
            ? paddleUsage
            : opts.where.key === 'business'
              ? businessPlan
              : null
        )
      );
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      const switchedIn = new Date('2026-06-05T00:00:00Z');
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({
          planKey: 'usage',
          billingMode: 'usage',
          provider: 'paddle',
          lifecycleOwner: 'provider',
          providerSubscriptionId: 'sub_ext',
          meteredFrom: switchedIn
        })
      );
      ctx.billing.getProviderById.mockReturnValue(provider('paddle', true));

      await ctx.service.changePlan('user-1', 'business');

      expect(ctx.emit).toHaveBeenCalledWith(
        UsagePeriodClosedEvent.name,
        expect.objectContaining({
          userId: 'user-1',
          subscriptionId: 'sub-1',
          periodStart: switchedIn,
          periodEnd: frozenNow,
          planKey: 'usage'
        })
      );
      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ id: 'sub-1' }),
        {
          planKey: 'business',
          billingMode: 'fixed',
          planChangeSeq: expect.any(Function) as unknown,
          meteredFrom: frozenNow
        }
      );
    });

    it('a switch that keeps the billing mode leaves the metered window alone', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({
          provider: 'paddle',
          lifecycleOwner: 'provider',
          providerSubscriptionId: 'sub_ext'
        })
      );
      ctx.billing.getProviderById.mockReturnValue(provider('paddle', true));

      await ctx.service.changePlan('user-1', 'business');

      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ id: 'sub-1' }),
        {
          planKey: 'business',
          billingMode: 'fixed',
          planChangeSeq: expect.any(Function) as unknown
        }
      );
      expect(ctx.emit).not.toHaveBeenCalledWith(
        UsagePeriodClosedEvent.name,
        expect.anything()
      );
    });

    it('moves no money on a trial switch', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ status: 'trialing', trialEnd: new Date('2026-06-25') })
      );
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'business');

      expect(yoo.chargeOffSession).not.toHaveBeenCalled();
      expect(yoo.refund).not.toHaveBeenCalled();
      expect(ctx.insertedInvoices).toHaveLength(0);
      expect(result.planKey).toBe('business');
    });

    it('a declined charge aborts the switch with nothing moved', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockRejectedValue(new Error('declined'));
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toThrow('declined');

      expect(yoo.refund).not.toHaveBeenCalled();
      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('guards: no subscription, same plan, past_due, scheduled cancel, missing provider price', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);

      ctx.subscriptions.findOne.mockResolvedValue(null);
      await expectRefusal(
        ctx.service.changePlan('user-1', 'pro'),
        NotFoundException,
        ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION
      );

      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      await expectRefusal(
        ctx.service.changePlan('user-1', 'pro'),
        ConflictException,
        ErrorKeys.BILLING.SAME_PLAN
      );

      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ status: 'past_due' })
      );
      await expectRefusal(
        ctx.service.changePlan('user-1', 'business'),
        ConflictException,
        ErrorKeys.BILLING.SUBSCRIPTION_NOT_CHANGEABLE
      );

      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ cancelAtPeriodEnd: true })
      );
      await expectRefusal(
        ctx.service.changePlan('user-1', 'business'),
        ConflictException,
        ErrorKeys.BILLING.CANCELLATION_SCHEDULED
      );

      // The usage plan carries no paddle price → unavailable for a paddle sub.
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ provider: 'paddle', providerSubscriptionId: 'sub_ext' })
      );
      await expectRefusal(
        ctx.service.changePlan('user-1', 'usage'),
        ConflictException,
        ErrorKeys.BILLING.PLAN_UNAVAILABLE_FOR_PROVIDER
      );
    });

    it('serializes concurrent changes: the claim CAS loser is rejected with no second charge', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed',
        refundedMinor: Money.fromMinor(0)
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      // First claim wins the compare-and-swap; the second misses (affected 0).
      ctx.subscriptions.update
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 0 });

      const results = await Promise.allSettled([
        ctx.service.changePlan('user-1', 'business'),
        ctx.service.changePlan('user-1', 'business')
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(rejected[0].reason).toMatchObject({
        response: { errorKey: ErrorKeys.BILLING.SUBSCRIPTION_BUSY }
      });
      // The loser never reaches the provider, so the customer is charged once.
      expect(yoo.chargeOffSession).toHaveBeenCalledTimes(1);
    });

    it('commits the charge invoice and the plan apply in one transaction — a commit failure announces nothing', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      // The single local transaction fails after the provider charge succeeded.
      ctx.dataSource.transaction.mockImplementation(() => {
        throw new Error('db write failed');
      });

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toThrow('db write failed');

      // The charge happened (idempotent for a later retry) but nothing local was
      // committed, so no PlanChanged / InvoicePaid escapes as "applied".
      expect(yoo.chargeOffSession).toHaveBeenCalledTimes(1);
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('excludes its own charge leg from the refund source so it cannot refund itself', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      let sourceWhere: Record<string, unknown> | undefined;
      ctx.invoices.findOne.mockImplementation(
        (options: { where: Record<string, unknown> }) => {
          sourceWhere = options.where;
          return Promise.resolve({
            id: 'inv-period',
            amountMinor: Money.fromMinor(99000),
            providerInvoiceRef: 'pay_period',
            status: 'paid',
            billingMode: 'fixed',
            refundedMinor: Money.fromMinor(0)
          });
        }
      );

      await ctx.service.changePlan('user-1', 'business');

      // The charge leg is on the books before the source is picked, so the
      // lookup must exclude it by id - a webhook settling it first would
      // otherwise make this switch refund the payment it just took.
      expect(ctx.insertedInvoices[0]['id']).toBe('inv-1');
      expect(sourceWhere).toMatchObject({ id: Not('inv-1') });
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        39600,
        expect.any(String)
      );
    });

    it('records the charge before asking the provider for the money', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      let recordedWhenCharged: InsertedInvoice | undefined;
      yoo.chargeOffSession.mockImplementation(() => {
        recordedWhenCharged = { ...ctx.insertedInvoices[0] };
        return Promise.resolve({
          providerInvoiceRef: 'pay_change',
          status: 'captured'
        });
      });
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'business');

      expect(recordedWhenCharged).toMatchObject({
        providerEventId: 'change-charge:sub-1:0:business',
        amountMinor: Money.fromMinor(116000),
        status: 'pending',
        paidAt: null
      });
    });

    it('leaves the captured charge on the books when the closing transaction dies', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      const applyUpdate =
        ctx.dataSource.manager.update.getMockImplementation() as (
          target: unknown,
          criteria: unknown,
          patch: unknown
        ) => Promise<{ affected: number }>;
      // The request dies after the capture: a pool timeout, the provider
      // deadline unwinding the handler, a restart.
      ctx.dataSource.manager.update.mockImplementation(
        (target: unknown, criteria: unknown, patch: unknown) =>
          target === Subscription
            ? Promise.reject(new Error('connection terminated'))
            : applyUpdate(target, criteria, patch)
      );

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toThrow('connection terminated');

      // Without the pre-charge plant this leaves nothing at all: a real
      // payment with no invoice, no ledger row and no log line.
      expect(ctx.insertedInvoices).toHaveLength(1);
      expect(ctx.insertedInvoices[0]).toMatchObject({
        providerEventId: 'change-charge:sub-1:0:business',
        providerInvoiceRef: 'pay_change',
        amountMinor: Money.fromMinor(116000)
      });
    });

    it('a retry after the closing transaction died charges nothing again and refunds the same leg', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      const source = {
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(0),
        currency: 'RUB',
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      };
      ctx.invoices.findOne.mockResolvedValue(source);
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      const applyUpdate =
        ctx.dataSource.manager.update.getMockImplementation() as (
          target: unknown,
          criteria: unknown,
          patch: unknown
        ) => Promise<{ affected: number }>;
      ctx.dataSource.manager.update.mockImplementationOnce(() =>
        Promise.reject(new Error('connection terminated'))
      );

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toThrow('connection terminated');
      ctx.dataSource.manager.update.mockImplementation(applyUpdate);
      // The confirming webhook settles the charge before the retry.
      Object.assign(ctx.insertedInvoices[0], { status: 'paid' });
      ctx.emit.mockClear();

      const result = await ctx.service.changePlan('user-1', 'business');

      expect(yoo.chargeOffSession).toHaveBeenCalledTimes(1);
      expect(yoo.refund).toHaveBeenCalledTimes(2);
      expect(yoo.refund).toHaveBeenNthCalledWith(
        2,
        'pay_period',
        39600,
        'change-refund:sub-1:0'
      );
      expect(source.refundedMinor).toEqual(Money.fromMinor(39600));
      expect(ctx.insertedInvoices).toHaveLength(2);
      expect(ctx.insertedInvoices[1]).toMatchObject({
        providerEventId: 'change-refund:sub-1:0',
        amountMinor: Money.fromMinor(39600),
        status: 'refunded'
      });
      // The webhook announced the payment when it settled the row.
      expect(ctx.emit).not.toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.anything()
      );
      expect(result.planKey).toBe('business');
    });

    it('gives the reservation back and drops the pending leg when the refund fails', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      const source = {
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(0),
        currency: 'RUB',
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      };
      ctx.invoices.findOne.mockResolvedValue(source);
      const yoo = provider('yookassa', false);
      yoo.refund.mockRejectedValue(new Error('refund refused'));
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'business');

      expect(source.refundedMinor).toEqual(Money.fromMinor(0));
      expect(ctx.insertedInvoices).toHaveLength(1);
      expect(ctx.insertedInvoices[0]).toMatchObject({
        providerEventId: 'change-charge:sub-1:0:business',
        status: 'paid'
      });
    });

    it('keys the legs on the count of committed switches', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planChangeSeq: 2 })
      );
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(0),
        currency: 'RUB',
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'business');

      expect(yoo.chargeOffSession).toHaveBeenCalledWith(
        customer,
        116000,
        'RUB',
        expect.any(Array),
        'change-charge:sub-1:2:business'
      );
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        39600,
        'change-refund:sub-1:2'
      );
    });

    it('marks the planted row failed when the provider declines the card', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockRejectedValue(
        new ChargeDeclinedError('card declined')
      );
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toBeInstanceOf(ChargeDeclinedError);

      // A decline is the one charge failure whose outcome is known, so the
      // row reads failed rather than lingering as money the customer owes.
      expect(ctx.insertedInvoices[0]).toMatchObject({ status: 'failed' });
      expect(yoo.refund).not.toHaveBeenCalled();
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('leaves the planted row pending when the charge outcome is unknown', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockRejectedValue(
        new ProviderTimeoutError('yookassa', 'chargeOffSession', 20000)
      );
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toBeInstanceOf(ProviderTimeoutError);

      // The deadline bounds our call, not the provider's request: the payment
      // may still capture, and the confirming webhook settles this row.
      expect(ctx.insertedInvoices[0]).toMatchObject({ status: 'pending' });
    });

    it('applies the switch as a guarded write of the plan columns and the switch counter, never as a whole-entity save', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      await ctx.service.changePlan('user-1', 'business');

      // Nothing the concurrent writer owns (status, period, dunning, cancel
      // flag) may appear in the write set, and the guard carries the claimed
      // version, mode and period so a row that moved during the charge loses.
      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Subscription,
        {
          id: 'sub-1',
          version: 2,
          billingMode: 'fixed',
          status: In(['trialing', 'active']),
          cancelAtPeriodEnd: false,
          currentPeriodEnd: periodEnd
        },
        {
          planKey: 'business',
          billingMode: 'fixed',
          planChangeSeq: expect.any(Function) as unknown
        }
      );
    });

    it('refuses the switch but keeps the money recorded when the row moved during the charge', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      // A cancel (or any guarded column change) landed while the charge was in
      // flight, so the apply finds no row matching the claim. Only the
      // subscription write misses - the invoice legs still settle.
      const applyUpdate =
        ctx.dataSource.manager.update.getMockImplementation() as (
          target: unknown,
          criteria: unknown,
          patch: unknown
        ) => Promise<{ affected: number }>;
      ctx.dataSource.manager.update.mockImplementation(
        (target: unknown, criteria: unknown, patch: unknown) =>
          target === Subscription
            ? Promise.resolve({ affected: 0 })
            : applyUpdate(target, criteria, patch)
      );

      await expectRefusal(
        ctx.service.changePlan('user-1', 'business'),
        ConflictException,
        ErrorKeys.BILLING.PLAN_CHANGE_PAYMENT_CONFLICT
      );

      expect(yoo.chargeOffSession).toHaveBeenCalledTimes(1);
      // The charge left the customer's card, so its invoice must survive the
      // refused switch — nothing else would ever record it.
      expect(ctx.insertedInvoices).toHaveLength(1);
      expect(ctx.insertedInvoices[0]).toMatchObject({ status: 'paid' });
      expect(
        ctx.emit.mock.calls.filter(
          (call: unknown[]) => call[0] === PlanChangedEvent.name
        )
      ).toHaveLength(0);
      expect(ctx.emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1' })
      );
    });

    it('rejects a provider-managed change whose local row moved during the provider call', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({
          provider: 'paddle',
          lifecycleOwner: 'provider',
          providerSubscriptionId: 'sub_ext'
        })
      );
      ctx.billing.getProviderById.mockReturnValue(provider('paddle', true));
      ctx.dataSource.manager.update.mockResolvedValue({ affected: 0 });

      await expectRefusal(
        ctx.service.changePlan('user-1', 'business'),
        ConflictException,
        ErrorKeys.BILLING.PLAN_CHANGE_CONFLICT
      );

      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('caps the proration refund by the source’s already-refunded amount', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed',
        refundedMinor: Money.fromMinor(80000)
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'business');

      // refundable = 99000 - 80000 = 19000; the 39600 remainder is capped to it.
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        19000,
        expect.any(String)
      );
      // The earlier legs and this one add up to the whole invoice.
      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Invoice,
        { id: 'inv-period', status: 'paid' },
        { status: 'refunded' }
      );
    });

    it('keeps the source paid when the full proration refund fails at the provider', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planKey: 'business' })
      );
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(100000),
        refundedMinor: Money.fromMinor(0),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      yoo.refund.mockRejectedValue(new Error('provider down'));
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'pro');

      expect(result.planKey).toBe('pro');
      expect(ctx.dataSource.manager.update).not.toHaveBeenCalledWith(
        Invoice,
        expect.objectContaining({ id: 'inv-period' }),
        expect.anything()
      );
    });
  });

  describe('previewChange', () => {
    const customer = {
      id: 'cust-1',
      userId: 'user-1',
      country: 'RU',
      currency: 'RUB',
      providerOverride: null
    };
    const periodEnd = new Date('2026-07-01T00:00:00Z');

    beforeEach(() => {
      jest.useFakeTimers({
        now: new Date('2026-06-19T00:00:00Z'),
        doNotFake: ['nextTick']
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function setupYoo(ctx: Awaited<ReturnType<typeof build>>) {
      const byKey: Record<string, Plan> = {
        pro: makePlan(),
        business: makePlan({
          id: 'plan-business',
          key: 'business',
          name: 'Business',
          prices: { yookassa: { currency: 'RUB', amountMinor: 290000 } }
        })
      };
      ctx.plans.findOne.mockImplementation((opts: { where: { key: string } }) =>
        Promise.resolve(byKey[opts.where.key] ?? null)
      );
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        customerId: 'cust-1',
        planKey: 'pro',
        provider: 'yookassa',
        billingMode: 'fixed',
        status: 'active',
        currentPeriodStart: new Date('2026-06-01T00:00:00Z'),
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false
      });
    }

    function periodInvoice(refundedMinor: number) {
      return {
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(refundedMinor),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      };
    }

    it('returns the computed split for a self-managed subscription', async () => {
      const ctx = await build();
      setupYoo(ctx);
      ctx.invoices.findOne.mockResolvedValue(periodInvoice(0));
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const preview = await ctx.service.previewChange('user-1', 'business');

      expect(preview).toEqual({
        provider: 'yookassa',
        fromPlanKey: 'pro',
        toPlanKey: 'business',
        currency: 'RUB',
        creditMinor: 39600,
        chargeMinor: 116000,
        dueNowMinor: 76400
      });
      expect(ctx.invoices.findOne).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-1',
          status: 'paid',
          billingMode: 'fixed'
        },
        order: { createdAt: 'DESC' }
      });
    });

    it('caps the credit by what is still refundable on the source invoice', async () => {
      const ctx = await build();
      setupYoo(ctx);
      ctx.invoices.findOne.mockResolvedValue(periodInvoice(80000));
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const preview = await ctx.service.previewChange('user-1', 'business');

      // refundable = 99000 - 80000 = 19000, the same cap changePlan applies.
      expect(preview).toMatchObject({
        creditMinor: 19000,
        chargeMinor: 116000,
        dueNowMinor: 97000
      });
    });

    it('shows no credit when no paid fixed invoice covers the period', async () => {
      const ctx = await build();
      setupYoo(ctx);
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const preview = await ctx.service.previewChange('user-1', 'business');

      expect(preview).toMatchObject({
        creditMinor: 0,
        chargeMinor: 116000,
        dueNowMinor: 116000
      });
    });

    it('returns the provider net for a delegated subscription', async () => {
      const ctx = await build();
      const byKey: Record<string, Plan> = {
        pro: makePlan({
          prices: {
            paddle: {
              currency: 'USD',
              amountMinor: 1200,
              providerPriceId: 'pri_pro'
            }
          }
        }),
        business: makePlan({
          id: 'plan-business',
          key: 'business',
          name: 'Business',
          prices: {
            paddle: {
              currency: 'USD',
              amountMinor: 2900,
              providerPriceId: 'pri_biz'
            }
          }
        })
      };
      ctx.plans.findOne.mockImplementation((opts: { where: { key: string } }) =>
        Promise.resolve(byKey[opts.where.key] ?? null)
      );
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        planKey: 'pro',
        provider: 'paddle',
        status: 'active',
        providerSubscriptionId: 'sub_ext',
        currentPeriodStart: new Date('2026-06-01T00:00:00Z'),
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false
      });
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      const preview = await ctx.service.previewChange('user-1', 'business');

      expect(paddle.previewChangePlan).toHaveBeenCalledWith(
        'sub_ext',
        expect.objectContaining({ key: 'business' })
      );
      expect(preview).toEqual({
        provider: 'paddle',
        fromPlanKey: 'pro',
        toPlanKey: 'business',
        currency: 'USD',
        creditMinor: null,
        chargeMinor: null,
        dueNowMinor: 1700
      });
    });
  });
});
