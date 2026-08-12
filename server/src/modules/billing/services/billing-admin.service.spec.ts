import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  NotFoundException
} from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { In, IsNull } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Money } from '@app/shared/utils/money';
import { DEFAULT_CURSOR_PAGE_SIZE } from '@app/shared/constants/pagination.constants';
import { InvoiceCursorQueryDto } from '../dtos/billing-cursor-query.dto';
import { encodeCursor } from '../../../common/utils/cursor.util';
import { Customer } from '../entities/customer.entity';
import { CustomerGrant } from '../entities/customer-grant.entity';
import { Invoice } from '../entities/invoice.entity';
import { Product } from '../entities/product.entity';
import { Subscription } from '../entities/subscription.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { EntitlementService } from '../entitlements/entitlement.service';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import { BillingService } from '../billing.service';
import { OPEN_STATUSES } from '../utils/subscription-status.util';
import { BillingAdminService } from './billing-admin.service';
import { CreditService } from './credit.service';

type QueryBuilderMock = {
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
};

type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  createQueryBuilder: jest.Mock;
  qb: QueryBuilderMock;
  save: jest.Mock;
  update: jest.Mock;
};

/** Chainable query-builder stub; `getMany` is what each test drives. */
function queryBuilder(): QueryBuilderMock {
  const qb: Partial<QueryBuilderMock> = {};
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.addOrderBy = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.getMany = jest.fn().mockResolvedValue([]);
  return qb as QueryBuilderMock;
}

function repo(): RepoMock {
  const qb = queryBuilder();
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    qb,
    save: jest.fn((entity: object) => Promise.resolve(entity)),
    update: jest.fn().mockResolvedValue({ affected: 0 })
  };
}

function cursorQuery(overrides: Partial<InvoiceCursorQueryDto> = {}) {
  return Object.assign(new InvoiceCursorQueryDto(), overrides);
}

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    customerId: 'cust-1',
    planKey: 'pro',
    provider: 'yookassa',
    billingMode: 'fixed',
    status: 'active',
    lifecycleOwner: 'self',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    providerSubscriptionId: null,
    paymentMethodId: null,
    dunningAttempts: 0,
    nextRenewalAttemptAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as Subscription;
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    customerId: 'cust-1',
    subscriptionId: 'sub-1',
    provider: 'yookassa',
    providerEventId: null,
    providerInvoiceRef: 'pay_1',
    amountMinor: Money.fromMinor(99000),
    refundedMinor: Money.fromMinor(0),
    currency: 'RUB',
    status: 'paid',
    billingMode: 'fixed',
    kind: 'subscription',
    productId: null,
    periodStart: new Date(),
    periodEnd: new Date(),
    paidAt: new Date(),
    receiptRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as Invoice;
}

function providerStub(id: BillingProviderId) {
  return {
    id,
    cancel: jest.fn().mockResolvedValue(undefined),
    refund: jest.fn().mockResolvedValue(undefined)
  };
}

async function build() {
  const subscriptions = repo();
  const invoices = repo();
  const customers = repo();
  const webhookEvents = repo();
  const grants = repo();
  const products = repo();
  const emit = jest.fn();

  const billing = {
    getProviderById: jest.fn()
  };
  const entitlements = {
    invalidateUser: jest.fn().mockResolvedValue(undefined)
  };
  const credits = {
    clawbackPurchase: jest.fn().mockResolvedValue(undefined)
  };

  // Transactional manager that routes the refund's entity-typed calls to the
  // same repo mocks, so the existing per-test setups/assertions still apply.
  const manager = {
    findOne: jest.fn((entity: unknown, options: unknown): Promise<unknown> => {
      if (entity === Invoice)
        return invoices.findOne(options) as Promise<unknown>;
      if (entity === Product)
        return products.findOne(options) as Promise<unknown>;
      return Promise.resolve(null);
    }),
    update: jest.fn(
      (
        entity: unknown,
        criteria: unknown,
        partial: unknown
      ): Promise<unknown> => {
        if (entity === CustomerGrant)
          return grants.update(criteria, partial) as Promise<unknown>;
        return Promise.resolve({ affected: 0 });
      }
    ),
    save: jest.fn((entity: unknown, data: unknown): Promise<unknown> => {
      if (entity === Invoice) return invoices.save(data) as Promise<unknown>;
      return Promise.resolve(data);
    })
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager))
  };

  const module = await Test.createTestingModule({
    providers: [
      BillingAdminService,
      { provide: getRepositoryToken(Subscription), useValue: subscriptions },
      { provide: getRepositoryToken(Invoice), useValue: invoices },
      { provide: getRepositoryToken(Customer), useValue: customers },
      { provide: getRepositoryToken(WebhookEvent), useValue: webhookEvents },
      { provide: getRepositoryToken(CustomerGrant), useValue: grants },
      { provide: getRepositoryToken(Product), useValue: products },
      { provide: BillingService, useValue: billing },
      { provide: EntitlementService, useValue: entitlements },
      { provide: CreditService, useValue: credits },
      { provide: EventEmitter2, useValue: { emit } },
      { provide: getDataSourceToken(), useValue: dataSource }
    ]
  }).compile();

  return {
    service: module.get(BillingAdminService),
    subscriptions,
    invoices,
    customers,
    webhookEvents,
    grants,
    products,
    billing,
    entitlements,
    credits,
    emit,
    manager,
    dataSource
  };
}

describe('BillingAdminService', () => {
  describe('listSubscriptions / listInvoices', () => {
    it('lists subscriptions newest first, bounded to one page', async () => {
      const ctx = await build();
      await ctx.service.listSubscriptions(cursorQuery());

      expect(ctx.subscriptions.qb.orderBy).toHaveBeenCalledWith(
        'subscription.createdAt',
        'DESC'
      );
      expect(ctx.subscriptions.qb.addOrderBy).toHaveBeenCalledWith(
        'subscription.id',
        'DESC'
      );
      // limit + 1: the extra row is what decides hasMore.
      expect(ctx.subscriptions.qb.take).toHaveBeenCalledWith(
        DEFAULT_CURSOR_PAGE_SIZE + 1
      );
    });

    it('lists invoices newest first, bounded to one page', async () => {
      const ctx = await build();
      await ctx.service.listInvoices(cursorQuery());

      expect(ctx.invoices.qb.orderBy).toHaveBeenCalledWith(
        'invoice.createdAt',
        'DESC'
      );
      expect(ctx.invoices.qb.take).toHaveBeenCalledWith(
        DEFAULT_CURSOR_PAGE_SIZE + 1
      );
    });

    it('reports another page and mints a cursor when the extra row exists', async () => {
      const ctx = await build();
      const rows = Array.from({ length: 3 }, (_, i) =>
        makeSubscription({ id: `sub-${i}` })
      );
      ctx.subscriptions.qb.getMany.mockResolvedValue(rows);

      const result = await ctx.service.listSubscriptions(
        cursorQuery({ limit: 2 })
      );

      // The third row is the lookahead: it is dropped from the page.
      expect(result.data).toHaveLength(2);
      expect(result.meta.hasMore).toBe(true);
      expect(result.meta.nextCursor).toEqual(expect.any(String));
      expect(result.meta.limit).toBe(2);
    });

    it('closes the list when no extra row comes back', async () => {
      const ctx = await build();
      ctx.invoices.qb.getMany.mockResolvedValue([makeInvoice()]);

      const result = await ctx.service.listInvoices(cursorQuery({ limit: 2 }));

      expect(result.data).toHaveLength(1);
      expect(result.meta.hasMore).toBe(false);
      expect(result.meta.nextCursor).toBeNull();
    });

    it('walks past the cursor row on a follow-up page', async () => {
      const ctx = await build();
      const cursor = encodeCursor({
        sortValue: '2026-06-01T00:00:00.000Z',
        id: 'inv-7'
      });

      await ctx.service.listInvoices(cursorQuery({ limit: 1, cursor }));

      expect(ctx.invoices.qb.andWhere).toHaveBeenCalledWith(
        '(invoice.createdAt, invoice.id) < (:cursorSortValue, :cursorId)',
        { cursorSortValue: '2026-06-01T00:00:00.000Z', cursorId: 'inv-7' }
      );
    });
  });

  describe('cancelSubscription', () => {
    it('throws 404 when the subscription does not exist', async () => {
      const ctx = await build();
      ctx.subscriptions.findOne.mockResolvedValue(null);
      await expect(ctx.service.cancelSubscription('missing')).rejects.toThrow(
        NotFoundException
      );
    });

    it('marks period-end cancel without invalidating entitlements', async () => {
      const ctx = await build();
      ctx.subscriptions.findOne.mockResolvedValue(makeSubscription());
      ctx.subscriptions.update.mockResolvedValue({ affected: 1 });

      const saved = await ctx.service.cancelSubscription('sub-1', 'period_end');

      expect(saved.cancelAtPeriodEnd).toBe(true);
      expect(saved.status).toBe('active');
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('immediate cancel sets canceled, asks the provider, and emits the event', async () => {
      const ctx = await build();
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSubscription({ providerSubscriptionId: 'sub_ext_1' })
      );
      const yoo = providerStub('yookassa');
      ctx.billing.getProviderById.mockReturnValue(yoo);
      ctx.subscriptions.update.mockResolvedValue({ affected: 1 });
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1'
      });

      const saved = await ctx.service.cancelSubscription('sub-1', 'immediate');

      expect(yoo.cancel).toHaveBeenCalledWith('sub_ext_1', 'immediate');
      expect(saved.status).toBe('canceled');
      expect(saved.cancelAtPeriodEnd).toBe(false);
      // Only the cancel columns are written — the entity predates the provider
      // round-trip, so the whole row would carry that snapshot back. The status
      // predicate is what makes a concurrent cancel lose rather than overwrite.
      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
      expect(ctx.subscriptions.update).toHaveBeenCalledWith(
        { id: 'sub-1', status: In([...OPEN_STATUSES]) },
        { status: 'canceled', cancelAtPeriodEnd: false }
      );
      expect(ctx.emit).toHaveBeenCalledWith(
        SubscriptionCanceledEvent.name,
        expect.objectContaining({ userId: 'user-1', subscriptionId: 'sub-1' })
      );
    });

    it('does not call the provider for a self-managed sub without a provider ref', async () => {
      const ctx = await build();
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSubscription({ providerSubscriptionId: null })
      );
      ctx.subscriptions.update.mockResolvedValue({ affected: 1 });

      await ctx.service.cancelSubscription('sub-1', 'period_end');

      expect(ctx.billing.getProviderById).not.toHaveBeenCalled();
    });

    it('refuses a second cancel of an already-canceled subscription', async () => {
      const ctx = await build();
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSubscription({
          status: 'canceled',
          providerSubscriptionId: 'sub_ext_1'
        })
      );
      const yoo = providerStub('yookassa');
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(
        ctx.service.cancelSubscription('sub-1', 'immediate')
      ).rejects.toThrow(ConflictException);

      expect(yoo.cancel).not.toHaveBeenCalled();
      expect(ctx.subscriptions.update).not.toHaveBeenCalled();
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('refuses a period-end cancel of a canceled row rather than flagging it', async () => {
      const ctx = await build();
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSubscription({ status: 'canceled' })
      );

      await expect(
        ctx.service.cancelSubscription('sub-1', 'period_end')
      ).rejects.toThrow(ConflictException);

      // `canceled` together with `cancelAtPeriodEnd` is a pair no other writer
      // in the module can produce.
      expect(ctx.subscriptions.update).not.toHaveBeenCalled();
    });

    it('answers 409 when a concurrent cancel lands during the provider call', async () => {
      const ctx = await build();
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSubscription({ providerSubscriptionId: 'sub_ext_1' })
      );
      const yoo = providerStub('yookassa');
      ctx.billing.getProviderById.mockReturnValue(yoo);
      ctx.subscriptions.update.mockResolvedValue({ affected: 0 });

      await expect(
        ctx.service.cancelSubscription('sub-1', 'immediate')
      ).rejects.toThrow(ConflictException);

      expect(yoo.cancel).toHaveBeenCalledWith('sub_ext_1', 'immediate');
      expect(ctx.emit).not.toHaveBeenCalled();
    });
  });

  describe('refundInvoice', () => {
    it('throws 404 when the invoice does not exist', async () => {
      const ctx = await build();
      ctx.invoices.findOne.mockResolvedValue(null);
      await expect(ctx.service.refundInvoice('missing')).rejects.toThrow(
        NotFoundException
      );
    });

    it('row-locks the invoice in both the pricing and the settling transaction', async () => {
      const ctx = await build();
      ctx.invoices.findOne.mockResolvedValue(
        makeInvoice({
          kind: 'one_time',
          subscriptionId: null,
          productId: 'prod-cr',
          amountMinor: Money.fromMinor(49000)
        })
      );
      ctx.products.findOne.mockResolvedValue({
        id: 'prod-cr',
        type: 'credits',
        grant: { credits: 500 }
      });
      ctx.billing.getProviderById.mockReturnValue(providerStub('yookassa'));

      await ctx.service.refundInvoice('inv-1');

      // Both the validate/price read and the settle read must happen under a
      // pessimistic write lock, and the clawback must join the settling
      // transaction (same manager) so it commits atomically with the flip.
      expect(ctx.dataSource.transaction).toHaveBeenCalledTimes(2);
      expect(ctx.manager.findOne).toHaveBeenCalledTimes(3);
      expect(ctx.manager.findOne).toHaveBeenNthCalledWith(
        1,
        Invoice,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } })
      );
      expect(ctx.manager.findOne).toHaveBeenNthCalledWith(
        2,
        Invoice,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } })
      );
      expect(ctx.credits.clawbackPurchase).toHaveBeenCalledWith(
        ctx.manager,
        'cust-1',
        'inv-1',
        500
      );
    });

    it('calls the provider outside any open transaction', async () => {
      const ctx = await build();
      ctx.invoices.findOne.mockResolvedValue(makeInvoice());
      let openTransactions = 0;
      const seenDuringRefund: number[] = [];
      ctx.dataSource.transaction.mockImplementation(async (cb) => {
        openTransactions++;
        try {
          return await cb(ctx.manager);
        } finally {
          openTransactions--;
        }
      });
      const yoo = providerStub('yookassa');
      yoo.refund.mockImplementation(() => {
        seenDuringRefund.push(openTransactions);
        return Promise.resolve();
      });
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.refundInvoice('inv-1');

      // A slow provider round-trip must not pin a pool connection or hold the
      // invoice row lock.
      expect(seenDuringRefund).toEqual([0]);
    });

    it('reserves the leg on the invoice before calling the provider', async () => {
      const ctx = await build();
      const invoice = makeInvoice();
      ctx.invoices.findOne.mockResolvedValue(invoice);
      const yoo = providerStub('yookassa');
      const reservedAtCallTime: string[] = [];
      yoo.refund.mockImplementation(() => {
        reservedAtCallTime.push(invoice.refundedMinor.toMinorString());
        return Promise.resolve();
      });
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.refundInvoice('inv-1', 50000);

      expect(reservedAtCallTime).toEqual(['50000']);
    });

    it('rejects a concurrent leg against the reserved total before it reaches the provider', async () => {
      const ctx = await build();
      ctx.invoices.findOne.mockResolvedValue(
        makeInvoice({
          kind: 'one_time',
          subscriptionId: null,
          productId: 'prod-cr',
          amountMinor: Money.fromMinor(49000)
        })
      );
      ctx.products.findOne.mockResolvedValue({
        id: 'prod-cr',
        type: 'credits',
        grant: { credits: 500 }
      });
      const yoo = providerStub('yookassa');
      let releaseFirst!: () => void;
      yoo.refund.mockImplementationOnce(
        () => new Promise<void>((resolve) => (releaseFirst = resolve))
      );
      ctx.billing.getProviderById.mockReturnValue(yoo);

      // The first refund parks inside the provider call, so the row lock is
      // released while its money is in flight - the window a second leg used to
      // price itself from a base that no longer reflected reality.
      const firstPromise = ctx.service.refundInvoice('inv-1');
      await new Promise((resolve) => setImmediate(resolve));
      await expect(ctx.service.refundInvoice('inv-1', 10000)).rejects.toThrow(
        BadRequestException
      );
      releaseFirst();
      const first = await firstPromise;

      expect(yoo.refund).toHaveBeenCalledTimes(1);
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_1',
        49000,
        'refund-inv-1-49000'
      );
      expect(first.refundedMinor.toMinorString()).toBe('49000');
      expect(first.status).toBe('refunded');
      expect(ctx.credits.clawbackPurchase).toHaveBeenCalledTimes(1);
    });

    it('releases the reservation when the provider call fails', async () => {
      const ctx = await build();
      const invoice = makeInvoice();
      ctx.invoices.findOne.mockResolvedValue(invoice);
      const yoo = providerStub('yookassa');
      yoo.refund.mockRejectedValueOnce(new Error('provider down'));
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(ctx.service.refundInvoice('inv-1', 50000)).rejects.toThrow(
        'provider down'
      );

      expect(invoice.refundedMinor.toMinorString()).toBe('0');
      expect(invoice.status).toBe('paid');

      // The released amount is refundable again, and the retry prices from the
      // same base, so it reuses the idempotency key of the failed attempt.
      yoo.refund.mockResolvedValue(undefined);
      await ctx.service.refundInvoice('inv-1', 50000);
      expect(yoo.refund).toHaveBeenNthCalledWith(
        2,
        'pay_1',
        50000,
        'refund-inv-1-50000'
      );
    });

    it('does not settle on a concurrent leg reservation whose money is still in flight', async () => {
      const ctx = await build();
      ctx.invoices.findOne.mockResolvedValue(
        makeInvoice({
          kind: 'one_time',
          subscriptionId: null,
          productId: 'prod-cr',
          amountMinor: Money.fromMinor(49000)
        })
      );
      ctx.products.findOne.mockResolvedValue({
        id: 'prod-cr',
        type: 'credits',
        grant: { credits: 500 }
      });
      const yoo = providerStub('yookassa');
      const releases: (() => void)[] = [];
      yoo.refund.mockImplementation(
        () => new Promise<void>((resolve) => releases.push(resolve))
      );
      ctx.billing.getProviderById.mockReturnValue(yoo);

      // Two halves are in flight at once, so the row reads as fully refunded
      // while neither leg has heard back from the provider.
      const firstPromise = ctx.service.refundInvoice('inv-1', 24500);
      await new Promise((resolve) => setImmediate(resolve));
      const secondPromise = ctx.service.refundInvoice('inv-1', 24500);
      await new Promise((resolve) => setImmediate(resolve));

      releases[0]();
      const first = await firstPromise;
      expect(first.status).toBe('paid');
      expect(ctx.credits.clawbackPurchase).not.toHaveBeenCalled();

      releases[1]();
      const second = await secondPromise;
      expect(second.status).toBe('refunded');
      expect(ctx.credits.clawbackPurchase).toHaveBeenCalledTimes(1);
    });

    it('rejects a repeat full refund and claws credits back exactly once', async () => {
      const ctx = await build();
      // The same row is re-read on the second call (a serialized concurrent
      // refund sees the committed state): once flipped to `refunded` it can no
      // longer be refunded, so the clawback runs exactly once.
      ctx.invoices.findOne.mockResolvedValue(
        makeInvoice({
          kind: 'one_time',
          subscriptionId: null,
          productId: 'prod-cr',
          amountMinor: Money.fromMinor(49000)
        })
      );
      ctx.products.findOne.mockResolvedValue({
        id: 'prod-cr',
        type: 'credits',
        grant: { credits: 500 }
      });
      ctx.billing.getProviderById.mockReturnValue(providerStub('yookassa'));

      const first = await ctx.service.refundInvoice('inv-1');
      expect(first.status).toBe('refunded');

      await expect(ctx.service.refundInvoice('inv-1')).rejects.toThrow(
        ConflictException
      );
      expect(ctx.credits.clawbackPurchase).toHaveBeenCalledTimes(1);
    });

    it('rejects refunding an unpaid invoice', async () => {
      const ctx = await build();
      ctx.invoices.findOne.mockResolvedValue(
        makeInvoice({ status: 'pending' })
      );
      await expect(ctx.service.refundInvoice('inv-1')).rejects.toThrow(
        ConflictException
      );
    });

    it('rejects a partial amount above the invoice total', async () => {
      const ctx = await build();
      ctx.invoices.findOne.mockResolvedValue(makeInvoice());
      await expect(ctx.service.refundInvoice('inv-1', 99001)).rejects.toThrow(
        BadRequestException
      );
    });

    it('rejects a refund that would push cumulative refunds past the total', async () => {
      const ctx = await build();
      // 50000 already refunded → only 49000 of the 99000 total remains.
      ctx.invoices.findOne.mockResolvedValue(
        makeInvoice({ refundedMinor: Money.fromMinor(50000) })
      );
      const yoo = providerStub('yookassa');
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(ctx.service.refundInvoice('inv-1', 50000)).rejects.toThrow(
        BadRequestException
      );
      expect(yoo.refund).not.toHaveBeenCalled();
    });

    it('full refund marks the invoice refunded and calls the provider', async () => {
      const ctx = await build();
      ctx.invoices.findOne.mockResolvedValue(makeInvoice());
      const yoo = providerStub('yookassa');
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const saved = await ctx.service.refundInvoice('inv-1');

      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_1',
        99000,
        expect.any(String)
      );
      expect(saved.status).toBe('refunded');
    });

    it('partial refund leaves the invoice paid', async () => {
      const ctx = await build();
      ctx.invoices.findOne.mockResolvedValue(makeInvoice());
      const yoo = providerStub('yookassa');
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const saved = await ctx.service.refundInvoice('inv-1', 50000);

      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_1',
        50000,
        expect.any(String)
      );
      expect(saved.status).toBe('paid');
    });

    describe('one-time purchases', () => {
      function makeOneTimeInvoice(overrides: Partial<Invoice> = {}): Invoice {
        return makeInvoice({
          kind: 'one_time',
          subscriptionId: null,
          productId: 'prod-1',
          amountMinor: Money.fromMinor(49000),
          ...overrides
        });
      }

      it('full refund of an sku purchase revokes its grant and drops the cached entitlements', async () => {
        const ctx = await build();
        ctx.invoices.findOne.mockResolvedValue(makeOneTimeInvoice());
        ctx.grants.update.mockResolvedValue({ affected: 1 });
        ctx.customers.findOne.mockResolvedValue({
          id: 'cust-1',
          userId: 'user-1'
        });
        const yoo = providerStub('yookassa');
        ctx.billing.getProviderById.mockReturnValue(yoo);

        const saved = await ctx.service.refundInvoice('inv-1');

        expect(saved.status).toBe('refunded');
        expect(ctx.grants.update).toHaveBeenCalledWith(
          { sourceInvoiceId: 'inv-1', revokedAt: IsNull() },
          { revokedAt: expect.any(Date) as Date }
        );
        expect(ctx.entitlements.invalidateUser).toHaveBeenCalledWith('user-1');
      });

      it('two partial refunds summing to the total settle the invoice and revoke the sku grant once', async () => {
        const ctx = await build();
        // amountMinor 49000 → two 24500 legs reach the total.
        const invoice = makeOneTimeInvoice();
        ctx.invoices.findOne.mockResolvedValue(invoice);
        ctx.grants.update.mockResolvedValue({ affected: 1 });
        ctx.customers.findOne.mockResolvedValue({
          id: 'cust-1',
          userId: 'user-1'
        });
        const yoo = providerStub('yookassa');
        ctx.billing.getProviderById.mockReturnValue(yoo);

        const first = await ctx.service.refundInvoice('inv-1', 24500);
        expect(first.status).toBe('paid');
        expect(ctx.grants.update).not.toHaveBeenCalled();

        const second = await ctx.service.refundInvoice('inv-1', 24500);
        expect(second.status).toBe('refunded');
        expect(ctx.grants.update).toHaveBeenCalledTimes(1);
        expect(ctx.entitlements.invalidateUser).toHaveBeenCalledTimes(1);

        // Each leg keys on the cumulative-after total, so the provider sees two
        // distinct refunds (the original bug let identical-amount legs collide).
        expect(yoo.refund).toHaveBeenNthCalledWith(
          1,
          'pay_1',
          24500,
          'refund-inv-1-24500'
        );
        expect(yoo.refund).toHaveBeenNthCalledWith(
          2,
          'pay_1',
          24500,
          'refund-inv-1-49000'
        );
      });

      it('two partial refunds summing to the total claw the credit pack back once', async () => {
        const ctx = await build();
        const invoice = makeOneTimeInvoice({ productId: 'prod-cr' });
        ctx.invoices.findOne.mockResolvedValue(invoice);
        ctx.products.findOne.mockResolvedValue({
          id: 'prod-cr',
          type: 'credits',
          grant: { credits: 500 }
        });
        const yoo = providerStub('yookassa');
        ctx.billing.getProviderById.mockReturnValue(yoo);

        await ctx.service.refundInvoice('inv-1', 24500);
        expect(ctx.credits.clawbackPurchase).not.toHaveBeenCalled();

        const second = await ctx.service.refundInvoice('inv-1', 24500);
        expect(second.status).toBe('refunded');
        expect(ctx.credits.clawbackPurchase).toHaveBeenCalledTimes(1);
        expect(ctx.credits.clawbackPurchase).toHaveBeenCalledWith(
          ctx.manager,
          'cust-1',
          'inv-1',
          500
        );
      });

      it('partial refund of an sku purchase keeps the grant', async () => {
        const ctx = await build();
        ctx.invoices.findOne.mockResolvedValue(makeOneTimeInvoice());
        const yoo = providerStub('yookassa');
        ctx.billing.getProviderById.mockReturnValue(yoo);

        const saved = await ctx.service.refundInvoice('inv-1', 10000);

        expect(saved.status).toBe('paid');
        expect(ctx.grants.update).not.toHaveBeenCalled();
        expect(ctx.entitlements.invalidateUser).not.toHaveBeenCalled();
      });

      it('full refund of a custom purchase is a plain refund (no grants matched)', async () => {
        const ctx = await build();
        ctx.invoices.findOne.mockResolvedValue(
          makeOneTimeInvoice({ productId: 'prod-don' })
        );
        ctx.grants.update.mockResolvedValue({ affected: 0 });
        const yoo = providerStub('yookassa');
        ctx.billing.getProviderById.mockReturnValue(yoo);

        const saved = await ctx.service.refundInvoice('inv-1');

        expect(saved.status).toBe('refunded');
        expect(ctx.entitlements.invalidateUser).not.toHaveBeenCalled();
      });

      it('never touches grants when refunding a subscription invoice', async () => {
        const ctx = await build();
        ctx.invoices.findOne.mockResolvedValue(makeInvoice());
        const yoo = providerStub('yookassa');
        ctx.billing.getProviderById.mockReturnValue(yoo);

        await ctx.service.refundInvoice('inv-1');

        expect(ctx.grants.update).not.toHaveBeenCalled();
        expect(ctx.credits.clawbackPurchase).not.toHaveBeenCalled();
      });

      it('full refund of a credit pack claws the granted units back', async () => {
        const ctx = await build();
        ctx.invoices.findOne.mockResolvedValue(
          makeOneTimeInvoice({ productId: 'prod-cr' })
        );
        ctx.products.findOne.mockResolvedValue({
          id: 'prod-cr',
          type: 'credits',
          grant: { credits: 500 }
        });
        const yoo = providerStub('yookassa');
        ctx.billing.getProviderById.mockReturnValue(yoo);

        const saved = await ctx.service.refundInvoice('inv-1');

        expect(saved.status).toBe('refunded');
        expect(ctx.credits.clawbackPurchase).toHaveBeenCalledWith(
          ctx.manager,
          'cust-1',
          'inv-1',
          500
        );
      });

      it('partial refund of a credit pack claws nothing back', async () => {
        const ctx = await build();
        ctx.invoices.findOne.mockResolvedValue(
          makeOneTimeInvoice({ productId: 'prod-cr' })
        );
        ctx.products.findOne.mockResolvedValue({
          id: 'prod-cr',
          type: 'credits',
          grant: { credits: 500 }
        });
        const yoo = providerStub('yookassa');
        ctx.billing.getProviderById.mockReturnValue(yoo);

        const saved = await ctx.service.refundInvoice('inv-1', 10000);

        expect(saved.status).toBe('paid');
        expect(ctx.credits.clawbackPurchase).not.toHaveBeenCalled();
      });

      it('full refund of an sku purchase claws no credits back', async () => {
        const ctx = await build();
        ctx.invoices.findOne.mockResolvedValue(makeOneTimeInvoice());
        ctx.products.findOne.mockResolvedValue({
          id: 'prod-1',
          type: 'sku',
          grant: { entitlement: 'reports' }
        });
        const yoo = providerStub('yookassa');
        ctx.billing.getProviderById.mockReturnValue(yoo);

        await ctx.service.refundInvoice('inv-1');

        expect(ctx.credits.clawbackPurchase).not.toHaveBeenCalled();
      });
    });
  });

  describe('replayWebhookEvent', () => {
    it('throws 404 when the webhook event does not exist', async () => {
      const ctx = await build();
      ctx.webhookEvents.findOne.mockResolvedValue(null);
      await expect(ctx.service.replayWebhookEvent('missing')).rejects.toThrow(
        NotFoundException
      );
    });

    it('rejects replaying a row that is not dead-lettered', async () => {
      const ctx = await build();
      ctx.webhookEvents.findOne.mockResolvedValue({
        id: 'wh-1',
        status: 'received'
      });
      await expect(ctx.service.replayWebhookEvent('wh-1')).rejects.toThrow(
        ConflictException
      );
      expect(ctx.webhookEvents.update).not.toHaveBeenCalled();
    });

    it('resets a dead-lettered row to `received` and zeroes its failure history', async () => {
      const ctx = await build();
      ctx.webhookEvents.findOne.mockResolvedValue({
        id: 'wh-1',
        status: 'dead_letter'
      });

      const result = await ctx.service.replayWebhookEvent('wh-1');

      expect(ctx.webhookEvents.update).toHaveBeenCalledWith(
        { id: 'wh-1' },
        { status: 'received', attempts: 0, lastError: null }
      );
      expect(result).toEqual({ id: 'wh-1', status: 'received' });
    });
  });
});
