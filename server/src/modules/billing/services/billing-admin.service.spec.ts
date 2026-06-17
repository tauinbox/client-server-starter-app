import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  NotFoundException
} from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Money } from '@app/shared/utils/money';
import { Customer } from '../entities/customer.entity';
import { CustomerGrant } from '../entities/customer-grant.entity';
import { Invoice } from '../entities/invoice.entity';
import { Product } from '../entities/product.entity';
import { Subscription } from '../entities/subscription.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { EntitlementService } from '../entitlements/entitlement.service';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import { BillingService } from '../billing.service';
import { BillingAdminService } from './billing-admin.service';
import { CreditService } from './credit.service';

type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
};

function repo(): RepoMock {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((entity: object) => Promise.resolve(entity)),
    update: jest.fn().mockResolvedValue({ affected: 0 })
  };
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
    it('lists subscriptions newest first', async () => {
      const ctx = await build();
      await ctx.service.listSubscriptions();
      expect(ctx.subscriptions.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' }
      });
    });

    it('lists invoices newest first', async () => {
      const ctx = await build();
      await ctx.service.listInvoices();
      expect(ctx.invoices.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' }
      });
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
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1'
      });

      const saved = await ctx.service.cancelSubscription('sub-1', 'immediate');

      expect(yoo.cancel).toHaveBeenCalledWith('sub_ext_1', 'immediate');
      expect(saved.status).toBe('canceled');
      expect(saved.cancelAtPeriodEnd).toBe(false);
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

      await ctx.service.cancelSubscription('sub-1', 'period_end');

      expect(ctx.billing.getProviderById).not.toHaveBeenCalled();
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

    it('row-locks the invoice and runs the whole refund in one transaction', async () => {
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

      // Without the transaction + row lock two concurrent refunds both read
      // `paid` and double-claw; the read must happen under a pessimistic write
      // lock inside the transaction, and the clawback must join that same
      // transaction (same manager) so it commits atomically with the flip.
      expect(ctx.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(ctx.manager.findOne).toHaveBeenCalledWith(
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
