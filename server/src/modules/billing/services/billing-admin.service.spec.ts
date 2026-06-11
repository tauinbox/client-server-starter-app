import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  NotFoundException
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Customer } from '../entities/customer.entity';
import { CustomerGrant } from '../entities/customer-grant.entity';
import { Invoice } from '../entities/invoice.entity';
import { Subscription } from '../entities/subscription.entity';
import { EntitlementService } from '../entitlements/entitlement.service';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import { BillingService } from '../billing.service';
import { BillingAdminService } from './billing-admin.service';

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
    amountMinor: 99000,
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
  const grants = repo();
  const emit = jest.fn();

  const billing = {
    getProviderById: jest.fn()
  };
  const entitlements = {
    invalidateUser: jest.fn().mockResolvedValue(undefined)
  };

  const module = await Test.createTestingModule({
    providers: [
      BillingAdminService,
      { provide: getRepositoryToken(Subscription), useValue: subscriptions },
      { provide: getRepositoryToken(Invoice), useValue: invoices },
      { provide: getRepositoryToken(Customer), useValue: customers },
      { provide: getRepositoryToken(CustomerGrant), useValue: grants },
      { provide: BillingService, useValue: billing },
      { provide: EntitlementService, useValue: entitlements },
      { provide: EventEmitter2, useValue: { emit } }
    ]
  }).compile();

  return {
    service: module.get(BillingAdminService),
    subscriptions,
    invoices,
    customers,
    grants,
    billing,
    entitlements,
    emit
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

    describe('one-time purchases (design §20.5)', () => {
      function makeOneTimeInvoice(overrides: Partial<Invoice> = {}): Invoice {
        return makeInvoice({
          kind: 'one_time',
          subscriptionId: null,
          productId: 'prod-1',
          amountMinor: 49000,
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
      });
    });
  });
});
