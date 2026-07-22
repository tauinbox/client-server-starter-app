import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Money } from '@app/shared/utils/money';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Plan } from '../entities/plan.entity';
import { Product } from '../entities/product.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PaymentFailedEvent,
  SubscriptionActivatedEvent,
  SubscriptionCanceledEvent,
  SubscriptionRenewedEvent,
  UsagePeriodClosedEvent
} from '../events/billing.events';
import type {
  NormalizedEvent,
  NormalizedInvoicePayload,
  NormalizedPaymentFailedPayload,
  NormalizedPaymentMethodPayload,
  NormalizedSubscriptionPayload
} from '../providers/payment-provider.interface';
import { PaymentMethod } from '../entities/payment-method.entity';
import { CreditService } from '../services/credit.service';
import { BillingEventReducer } from './billing-event-reducer.service';

interface ManagerStubs {
  subscription: Subscription | null;
  plan: Plan | null;
  customer: Customer | null;
  invoice: Invoice | null;
  product: Product | null;
  invoiceInsertRows: Array<{ id: string }>;
  updateAffected: number;
}

function buildManager(stubs: ManagerStubs) {
  const save = jest.fn((entity: { id?: string }) =>
    Promise.resolve({ ...entity, id: entity.id ?? 'sub-new' })
  );
  const create = jest.fn((_entity: unknown, data: object) => ({ ...data }));
  const update = jest
    .fn()
    .mockResolvedValue({ affected: stubs.updateAffected });
  const findOne = jest.fn((entity: unknown, _opts: unknown) => {
    if (entity === Subscription) return Promise.resolve(stubs.subscription);
    if (entity === Plan) return Promise.resolve(stubs.plan);
    if (entity === Customer) return Promise.resolve(stubs.customer);
    if (entity === Invoice) return Promise.resolve(stubs.invoice);
    if (entity === Product) return Promise.resolve(stubs.product);
    return Promise.resolve(null);
  });
  const execute = jest.fn().mockResolvedValue({ raw: stubs.invoiceInsertRows });
  const insertValues = jest.fn();
  interface InsertBuilder {
    insert: () => InsertBuilder;
    into: () => InsertBuilder;
    values: (v: Record<string, unknown>) => InsertBuilder;
    orIgnore: () => InsertBuilder;
    returning: () => InsertBuilder;
    execute: jest.Mock;
  }
  const createQueryBuilder = jest.fn((): InsertBuilder => {
    const builder: InsertBuilder = {
      insert: () => builder,
      into: () => builder,
      values: (v) => {
        insertValues(v);
        return builder;
      },
      orIgnore: () => builder,
      returning: () => builder,
      execute
    };
    return builder;
  });
  return {
    save,
    create,
    update,
    findOne,
    createQueryBuilder,
    execute,
    insertValues
  };
}

async function build(stubs: Partial<ManagerStubs> = {}) {
  const manager = buildManager({
    subscription: null,
    plan: null,
    customer: null,
    invoice: null,
    product: null,
    invoiceInsertRows: [{ id: 'inv-1' }],
    updateAffected: 0,
    ...stubs
  });
  const emit = jest.fn();
  // Deliberately a different stub from the transactional `manager`: any write
  // that reaches `dataSource.manager` ran outside a transaction, and the tests
  // assert it stays untouched.
  const bareManager = buildManager({
    subscription: null,
    plan: null,
    customer: null,
    invoice: null,
    product: null,
    invoiceInsertRows: [],
    updateAffected: 0
  });
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    manager: bareManager
  };
  const credits = {
    addPurchase: jest.fn().mockResolvedValue(undefined),
    spendOnUsage: jest.fn().mockResolvedValue(undefined)
  };

  const module = await Test.createTestingModule({
    providers: [
      BillingEventReducer,
      { provide: getDataSourceToken(), useValue: dataSource },
      { provide: CreditService, useValue: credits },
      { provide: EventEmitter2, useValue: { emit } }
    ]
  }).compile();

  return {
    reducer: module.get(BillingEventReducer),
    manager,
    bareManager,
    dataSource,
    emit,
    credits
  };
}

const subPayload = (
  overrides: Partial<NormalizedSubscriptionPayload> = {}
): NormalizedSubscriptionPayload => ({
  ref: { customerId: 'cust-1', userId: 'user-1' },
  providerSubscriptionId: 'sub_123',
  status: 'active',
  planKey: 'pro',
  currentPeriodStart: '2026-06-01T00:00:00Z',
  currentPeriodEnd: '2026-07-01T00:00:00Z',
  cancelAtPeriodEnd: false,
  trialEnd: null,
  ...overrides
});

const event = (
  type: NormalizedEvent['type'],
  payload: unknown,
  provider: NormalizedEvent['provider'] = 'paddle'
): NormalizedEvent => ({
  provider,
  providerEventId: 'evt_1',
  type,
  payload
});

describe('BillingEventReducer', () => {
  describe('subscription events', () => {
    it('creates a new subscription on activation and emits SubscriptionActivated', async () => {
      const { reducer, manager, emit } = await build({
        plan: { billingMode: 'fixed' } as Plan
      });

      await reducer.reduce(event('subscription.activated', subPayload()));

      expect(manager.create).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({
          customerId: 'cust-1',
          planKey: 'pro',
          provider: 'paddle',
          status: 'active',
          lifecycleOwner: 'provider',
          providerSubscriptionId: 'sub_123'
        })
      );
      expect(emit).toHaveBeenCalledWith(
        SubscriptionActivatedEvent.name,
        expect.objectContaining({ userId: 'user-1', subscriptionId: 'sub-new' })
      );
    });

    it('skips creating a second subscription when the customer already has an open one', async () => {
      const { reducer, manager, emit } = await build();
      // First Subscription lookup (by providerSubscriptionId) misses, so the
      // create branch runs; the second (open-subscription guard) finds a conflict.
      let subLookups = 0;
      manager.findOne.mockImplementation((entity: unknown) => {
        if (entity === Subscription) {
          subLookups += 1;
          return Promise.resolve(
            subLookups === 1
              ? null
              : ({ id: 'sub-open', status: 'active' } as Subscription)
          );
        }
        if (entity === Plan)
          return Promise.resolve({ billingMode: 'fixed' } as Plan);
        return Promise.resolve(null);
      });

      await reducer.reduce(event('subscription.activated', subPayload()));

      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('stamps the event provider and derives the lifecycle owner (YooKassa = self)', async () => {
      const { reducer, manager } = await build({
        plan: { billingMode: 'fixed' } as Plan
      });

      await reducer.reduce(
        event('subscription.activated', subPayload(), 'yookassa')
      );

      expect(manager.create).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({
          provider: 'yookassa',
          lifecycleOwner: 'self'
        })
      );
    });

    it('updates an existing subscription on renewal and emits SubscriptionRenewed', async () => {
      const existing = {
        id: 'sub-1',
        status: 'active',
        providerSubscriptionId: 'sub_123'
      } as Subscription;
      const { reducer, manager, emit } = await build({
        subscription: existing
      });

      await reducer.reduce(
        event(
          'subscription.renewed',
          subPayload({ currentPeriodEnd: '2026-08-01T00:00:00Z' })
        )
      );

      expect(manager.create).not.toHaveBeenCalled();
      expect(existing.currentPeriodEnd).toEqual(
        new Date('2026-08-01T00:00:00Z')
      );
      expect(emit).toHaveBeenCalledWith(
        SubscriptionRenewedEvent.name,
        expect.objectContaining({ userId: 'user-1', subscriptionId: 'sub-1' })
      );
    });

    it('emits SubscriptionCanceled on cancellation', async () => {
      const existing = {
        id: 'sub-1',
        providerSubscriptionId: 'sub_123'
      } as Subscription;
      const { reducer, emit } = await build({ subscription: existing });

      await reducer.reduce(
        event('subscription.canceled', subPayload({ status: 'canceled' }))
      );

      expect(emit).toHaveBeenCalledWith(
        SubscriptionCanceledEvent.name,
        expect.objectContaining({ subscriptionId: 'sub-1' })
      );
    });

    it('skips when the event carries no customer reference', async () => {
      const { reducer, manager, emit } = await build();

      await reducer.reduce(
        event('subscription.activated', subPayload({ ref: {} }))
      );

      expect(manager.save).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('skips creating a subscription when no plan key is known', async () => {
      const { reducer, manager, emit } = await build({ subscription: null });

      await reducer.reduce(
        event('subscription.activated', subPayload({ planKey: null }))
      );

      expect(manager.save).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('resolves the user id via the customer when the event omits it', async () => {
      const { reducer, emit } = await build({
        plan: { billingMode: 'fixed' } as Plan,
        customer: { userId: 'user-from-db' } as Customer
      });

      await reducer.reduce(
        event(
          'subscription.activated',
          subPayload({ ref: { customerId: 'cust-1' } })
        )
      );

      expect(emit).toHaveBeenCalledWith(
        SubscriptionActivatedEvent.name,
        expect.objectContaining({ userId: 'user-from-db' })
      );
    });
  });

  describe('usage period rollover (provider-managed)', () => {
    const usageSub = () =>
      ({
        id: 'sub-1',
        billingMode: 'usage',
        lifecycleOwner: 'provider',
        providerSubscriptionId: 'sub_123',
        currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-06-01T00:00:00Z')
      }) as Subscription;

    it('emits UsagePeriodClosed with the closed period when the snapshot starts a new one', async () => {
      const { reducer, emit } = await build({ subscription: usageSub() });

      await reducer.reduce(
        event(
          'subscription.renewed',
          subPayload({
            currentPeriodStart: '2026-06-01T00:00:00Z',
            currentPeriodEnd: '2026-07-01T00:00:00Z'
          })
        )
      );

      expect(emit).toHaveBeenCalledWith(
        UsagePeriodClosedEvent.name,
        expect.objectContaining({
          userId: 'user-1',
          subscriptionId: 'sub-1',
          periodStart: new Date('2026-05-01T00:00:00Z'),
          periodEnd: new Date('2026-06-01T00:00:00Z')
        })
      );
    });

    it('does not emit when the snapshot stays inside the stored period', async () => {
      const { reducer, emit } = await build({ subscription: usageSub() });

      await reducer.reduce(
        event(
          'subscription.renewed',
          subPayload({
            currentPeriodStart: '2026-05-01T00:00:00Z',
            currentPeriodEnd: '2026-06-01T00:00:00Z'
          })
        )
      );

      expect(emit).not.toHaveBeenCalledWith(
        UsagePeriodClosedEvent.name,
        expect.anything()
      );
    });

    it('does not emit for fixed-mode subscriptions on rollover', async () => {
      const { reducer, emit } = await build({
        subscription: {
          ...usageSub(),
          billingMode: 'fixed'
        } as Subscription
      });

      await reducer.reduce(
        event(
          'subscription.renewed',
          subPayload({
            currentPeriodStart: '2026-06-01T00:00:00Z',
            currentPeriodEnd: '2026-07-01T00:00:00Z'
          })
        )
      );

      expect(emit).not.toHaveBeenCalledWith(
        UsagePeriodClosedEvent.name,
        expect.anything()
      );
    });
  });

  describe('invoice.paid — usage charge reconciliation', () => {
    const usagePaidPayload: NormalizedInvoicePayload = {
      ref: { customerId: 'cust-1', userId: 'user-1' },
      providerInvoiceRef: 'txn_usage',
      providerSubscriptionId: 'sub_123',
      amountMinor: 8400,
      currency: 'USD',
      periodStart: null,
      periodEnd: null,
      paidAt: '2026-06-01T00:05:00Z',
      usageChargeKey: 'usage:sub-1:1780272000000'
    };

    it('settles the pending usage invoice instead of inserting a new row', async () => {
      const { reducer, manager, emit } = await build({
        invoice: { id: 'inv-usage' } as Invoice,
        updateAffected: 1
      });

      await reducer.reduce(event('invoice.paid', usagePaidPayload));

      expect(manager.update).toHaveBeenCalledWith(
        Invoice,
        {
          providerEventId: 'usage:sub-1:1780272000000',
          status: 'pending'
        },
        expect.objectContaining({
          status: 'paid',
          providerInvoiceRef: 'txn_usage'
        })
      );
      expect(manager.execute).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1', invoiceId: 'inv-usage' })
      );
    });

    it('is a no-op when the keyed invoice is already settled (replay)', async () => {
      const { reducer, manager, emit } = await build({
        invoice: { id: 'inv-usage' } as Invoice,
        updateAffected: 0
      });

      await reducer.reduce(event('invoice.paid', usagePaidPayload));

      expect(manager.execute).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('falls back to a plain insert when the keyed invoice is missing', async () => {
      const { reducer, manager, emit } = await build({
        subscription: { id: 'sub-1', billingMode: 'usage' } as Subscription,
        invoice: null,
        invoiceInsertRows: [{ id: 'inv-2' }]
      });

      await reducer.reduce(event('invoice.paid', usagePaidPayload));

      expect(manager.execute).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ invoiceId: 'inv-2' })
      );
    });
  });

  describe('invoice.paid', () => {
    const invoicePayload: NormalizedInvoicePayload = {
      ref: { customerId: 'cust-1', userId: 'user-1' },
      providerInvoiceRef: 'txn_123',
      providerSubscriptionId: 'sub_123',
      amountMinor: 1200,
      currency: 'USD',
      periodStart: '2026-06-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      paidAt: '2026-06-01T00:05:00Z'
    };

    it('inserts an invoice and emits InvoicePaid', async () => {
      const { reducer, emit } = await build({
        subscription: { id: 'sub-1', billingMode: 'fixed' } as Subscription,
        invoiceInsertRows: [{ id: 'inv-1' }]
      });

      await reducer.reduce(event('invoice.paid', invoicePayload));

      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1', invoiceId: 'inv-1' })
      );
    });

    it('does not emit when the invoice insert is a duplicate (orIgnore no-op)', async () => {
      const { reducer, emit } = await build({
        subscription: { id: 'sub-1', billingMode: 'fixed' } as Subscription,
        invoiceInsertRows: []
      });

      await reducer.reduce(event('invoice.paid', invoicePayload));

      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('invoice.paid — self-managed (YooKassa) activation', () => {
    const selfManagedPayload: NormalizedInvoicePayload = {
      ref: { customerId: 'cust-1', userId: 'user-1' },
      providerInvoiceRef: 'pay_123',
      providerSubscriptionId: null,
      amountMinor: 99000,
      currency: 'RUB',
      periodStart: null,
      periodEnd: null,
      paidAt: '2026-06-01T00:05:00Z',
      savedPaymentMethod: {
        providerMethodRef: 'pm_tok',
        brand: 'Visa',
        last4: '4242'
      }
    };

    it('persists the saved card, activates the incomplete subscription, and emits both events', async () => {
      const { reducer, manager, emit } = await build({
        subscription: {
          id: 'sub-1',
          customerId: 'cust-1',
          provider: 'yookassa',
          billingMode: 'fixed',
          status: 'incomplete',
          trialEnd: null
        } as Subscription,
        invoiceInsertRows: [{ id: 'inv-1' }]
      });

      await reducer.reduce(
        event('invoice.paid', selfManagedPayload, 'yookassa')
      );

      expect(manager.update).toHaveBeenCalledWith(
        PaymentMethod,
        { customerId: 'cust-1', isDefault: true },
        { isDefault: false }
      );
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          providerMethodRef: 'pm_tok',
          brand: 'Visa',
          last4: '4242',
          isDefault: true
        })
      );
      expect(manager.update).toHaveBeenCalledWith(
        Customer,
        { id: 'cust-1' },
        { defaultPaymentMethodId: 'sub-new' }
      );
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub-1', status: 'active' })
      );
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1', invoiceId: 'inv-1' })
      );
      expect(emit).toHaveBeenCalledWith(
        SubscriptionActivatedEvent.name,
        expect.objectContaining({ userId: 'user-1', subscriptionId: 'sub-1' })
      );
    });

    it('does not re-activate on a replayed webhook (duplicate invoice insert)', async () => {
      const { reducer, manager, emit } = await build({
        subscription: {
          id: 'sub-1',
          customerId: 'cust-1',
          provider: 'yookassa',
          billingMode: 'fixed',
          status: 'incomplete',
          trialEnd: null
        } as Subscription,
        invoiceInsertRows: []
      });

      await reducer.reduce(
        event('invoice.paid', selfManagedPayload, 'yookassa')
      );

      expect(manager.update).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('invoice.paid — off-session charge reconcile', () => {
    const offSessionPayload: NormalizedInvoicePayload = {
      ref: { customerId: 'cust-1', userId: 'user-1' },
      providerInvoiceRef: 'pay-1',
      providerSubscriptionId: null,
      amountMinor: 99000,
      currency: 'RUB',
      periodStart: null,
      periodEnd: null,
      paidAt: '2026-06-08T00:01:00Z',
      offSessionChargeKey: 'renewal:sub-1:123:0'
    };

    it('settles the core-recorded pending invoice and emits InvoicePaid, without inserting or activating', async () => {
      const { reducer, manager, emit } = await build({
        updateAffected: 1,
        invoice: {
          id: 'inv-1',
          customerId: 'cust-1',
          status: 'pending',
          amountMinor: Money.fromMinor(99000),
          currency: 'RUB',
          creditUnitsApplied: 0
        } as Invoice
      });

      await reducer.reduce(
        event('invoice.paid', offSessionPayload, 'yookassa')
      );

      // The flip is status-gated so it settles exactly once against the
      // scheduler's own poll.
      expect(manager.update).toHaveBeenCalledWith(
        Invoice,
        { providerEventId: 'renewal:sub-1:123:0', status: 'pending' },
        {
          status: 'paid',
          providerInvoiceRef: 'pay-1',
          paidAt: new Date('2026-06-08T00:01:00Z')
        }
      );
      expect(manager.execute).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1', invoiceId: 'inv-1' })
      );
    });

    it('spends the credit units the pending charge was rated against on settle', async () => {
      const { reducer, credits } = await build({
        updateAffected: 1,
        invoice: {
          id: 'inv-1',
          customerId: 'cust-1',
          status: 'pending',
          amountMinor: Money.fromMinor(99000),
          currency: 'RUB',
          creditUnitsApplied: 10
        } as Invoice
      });

      await reducer.reduce(
        event('invoice.paid', offSessionPayload, 'yookassa')
      );

      expect(credits.spendOnUsage).toHaveBeenCalledWith(
        expect.anything(),
        'cust-1',
        'inv-1',
        10
      );
    });

    it('only reconciles the payment ref when the invoice was already settled', async () => {
      const { reducer, manager, emit, credits } = await build({
        updateAffected: 0,
        invoice: {
          id: 'inv-1',
          customerId: 'cust-1',
          status: 'paid',
          creditUnitsApplied: 10
        } as Invoice
      });

      await reducer.reduce(
        event('invoice.paid', offSessionPayload, 'yookassa')
      );

      expect(manager.update).toHaveBeenLastCalledWith(
        Invoice,
        { providerEventId: 'renewal:sub-1:123:0' },
        { providerInvoiceRef: 'pay-1' }
      );
      expect(credits.spendOnUsage).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('logs a mismatch between the charged and the recorded amount, and still settles', async () => {
      const { reducer, emit } = await build({
        updateAffected: 1,
        invoice: {
          id: 'inv-1',
          customerId: 'cust-1',
          status: 'pending',
          // The core rated and receipted 99000; the provider reports 88000.
          amountMinor: Money.fromMinor(88000),
          currency: 'RUB',
          creditUnitsApplied: 0
        } as Invoice
      });
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await reducer.reduce(
        event('invoice.paid', offSessionPayload, 'yookassa')
      );

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('mismatched amount')
      );
      // Refusing to settle would leave the invoice pending forever and make the
      // scheduler dun a customer whose money already moved.
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ invoiceId: 'inv-1' })
      );
      logged.mockRestore();
    });

    it('logs a currency mismatch as well as an amount mismatch', async () => {
      const { reducer } = await build({
        updateAffected: 1,
        invoice: {
          id: 'inv-1',
          customerId: 'cust-1',
          status: 'pending',
          amountMinor: Money.fromMinor(99000),
          currency: 'USD',
          creditUnitsApplied: 0
        } as Invoice
      });
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await reducer.reduce(
        event('invoice.paid', offSessionPayload, 'yookassa')
      );

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('recorded 99000 USD')
      );
      logged.mockRestore();
    });
  });

  describe('invoice.paid — one-time purchase', () => {
    const oneTimePayload: NormalizedInvoicePayload = {
      ref: { customerId: 'cust-1', userId: 'user-1' },
      providerInvoiceRef: 'pay_ot',
      providerSubscriptionId: null,
      amountMinor: 50000,
      currency: 'RUB',
      periodStart: null,
      periodEnd: null,
      paidAt: '2026-06-11T10:00:00Z',
      kind: 'one_time',
      productId: 'prod-1'
    };

    it('inserts a one_time invoice with no subscription and grants the sku entitlement', async () => {
      const { reducer, manager, emit } = await build({
        product: {
          id: 'prod-1',
          type: 'sku',
          grant: { entitlement: 'reports' }
        } as Product,
        invoiceInsertRows: [{ id: 'inv-ot' }]
      });

      await reducer.reduce(event('invoice.paid', oneTimePayload, 'yookassa'));

      expect(manager.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'one_time',
          productId: 'prod-1',
          subscriptionId: null,
          status: 'paid',
          billingMode: 'fixed'
        })
      );
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          entitlement: 'reports',
          sourceInvoiceId: 'inv-ot',
          expiresAt: null,
          revokedAt: null
        })
      );
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1', invoiceId: 'inv-ot' })
      );
      expect(emit).not.toHaveBeenCalledWith(
        SubscriptionActivatedEvent.name,
        expect.anything()
      );
    });

    it('sets the grant expiry from durationDays', async () => {
      const { reducer, manager } = await build({
        product: {
          id: 'prod-1',
          type: 'sku',
          grant: { entitlement: 'reports', durationDays: 30 }
        } as Product,
        invoiceInsertRows: [{ id: 'inv-ot' }]
      });

      await reducer.reduce(event('invoice.paid', oneTimePayload, 'yookassa'));

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          entitlement: 'reports',
          expiresAt: expect.any(Date) as Date
        })
      );
    });

    it('applies no grant for a custom (donation) product', async () => {
      const { reducer, manager, emit } = await build({
        product: { id: 'prod-don', type: 'custom', grant: null } as Product,
        invoiceInsertRows: [{ id: 'inv-don' }]
      });

      await reducer.reduce(
        event(
          'invoice.paid',
          { ...oneTimePayload, productId: 'prod-don' },
          'yookassa'
        )
      );

      expect(manager.save).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1', invoiceId: 'inv-don' })
      );
    });

    it('tops up the prepaid balance for a paid credit pack', async () => {
      const { reducer, manager, emit, credits } = await build({
        product: {
          id: 'prod-cr',
          type: 'credits',
          grant: { credits: 500 }
        } as Product,
        invoiceInsertRows: [{ id: 'inv-cr' }]
      });

      await reducer.reduce(
        event(
          'invoice.paid',
          { ...oneTimePayload, productId: 'prod-cr' },
          'yookassa'
        )
      );

      expect(credits.addPurchase).toHaveBeenCalledWith(
        expect.anything(),
        'cust-1',
        'inv-cr',
        500
      );
      // A credit pack writes no CustomerGrant.
      expect(manager.save).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1', invoiceId: 'inv-cr' })
      );
    });

    it('does not re-grant on a replayed webhook (duplicate invoice insert)', async () => {
      const { reducer, manager, emit, credits } = await build({
        product: {
          id: 'prod-1',
          type: 'sku',
          grant: { entitlement: 'reports' }
        } as Product,
        invoiceInsertRows: []
      });

      await reducer.reduce(event('invoice.paid', oneTimePayload, 'yookassa'));

      expect(manager.save).not.toHaveBeenCalled();
      expect(credits.addPurchase).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('does not top up on a replayed credit-pack webhook', async () => {
      const { reducer, credits } = await build({
        product: {
          id: 'prod-cr',
          type: 'credits',
          grant: { credits: 500 }
        } as Product,
        invoiceInsertRows: []
      });

      await reducer.reduce(
        event(
          'invoice.paid',
          { ...oneTimePayload, productId: 'prod-cr' },
          'yookassa'
        )
      );

      expect(credits.addPurchase).not.toHaveBeenCalled();
    });

    it('never links or activates an open self-managed subscription on a one-time payment', async () => {
      const { reducer, manager, emit } = await build({
        subscription: {
          id: 'sub-1',
          customerId: 'cust-1',
          provider: 'yookassa',
          billingMode: 'fixed',
          status: 'incomplete',
          trialEnd: null
        } as Subscription,
        product: { id: 'prod-don', type: 'custom', grant: null } as Product,
        invoiceInsertRows: [{ id: 'inv-ot' }]
      });

      await reducer.reduce(event('invoice.paid', oneTimePayload, 'yookassa'));

      expect(manager.findOne).not.toHaveBeenCalledWith(
        Subscription,
        expect.anything()
      );
      expect(manager.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: null })
      );
      expect(emit).not.toHaveBeenCalledWith(
        SubscriptionActivatedEvent.name,
        expect.anything()
      );
    });
  });

  describe('payment_method.updated', () => {
    const methodPayload: NormalizedPaymentMethodPayload = {
      ref: { customerId: 'cust-1', userId: 'user-1' },
      savedPaymentMethod: {
        providerMethodRef: 'tok-new',
        brand: 'MasterCard',
        last4: '4444'
      }
    };

    it('demotes the old default, saves the new card as default, and re-points the customer + subscription', async () => {
      const subscription = {
        id: 'sub-1',
        customerId: 'cust-1',
        paymentMethodId: 'pm-old'
      } as Subscription;
      const { reducer, manager, emit } = await build({ subscription });

      await reducer.reduce(
        event('payment_method.updated', methodPayload, 'yookassa')
      );

      expect(manager.update).toHaveBeenCalledWith(
        PaymentMethod,
        { customerId: 'cust-1', isDefault: true },
        { isDefault: false }
      );
      expect(manager.create).toHaveBeenCalledWith(
        PaymentMethod,
        expect.objectContaining({
          customerId: 'cust-1',
          provider: 'yookassa',
          providerMethodRef: 'tok-new',
          brand: 'MasterCard',
          last4: '4444',
          isDefault: true
        })
      );
      expect(manager.update).toHaveBeenCalledWith(
        Customer,
        { id: 'cust-1' },
        { defaultPaymentMethodId: 'sub-new' }
      );
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub-1', paymentMethodId: 'sub-new' })
      );
      // No money moved: no invoice insert, no status change, no domain event.
      expect(manager.execute).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('leaves the subscription untouched when the customer has none open', async () => {
      const { reducer, manager } = await build({ subscription: null });

      await reducer.reduce(
        event('payment_method.updated', methodPayload, 'yookassa')
      );

      expect(manager.update).toHaveBeenCalledWith(
        Customer,
        { id: 'cust-1' },
        { defaultPaymentMethodId: 'sub-new' }
      );
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('skips when the event carries no saved method', async () => {
      const { reducer, manager } = await build();

      await reducer.reduce(
        event(
          'payment_method.updated',
          { ...methodPayload, savedPaymentMethod: null },
          'yookassa'
        )
      );

      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('skips when the event carries no customer reference', async () => {
      const { reducer, manager } = await build();

      await reducer.reduce(
        event(
          'payment_method.updated',
          { ...methodPayload, ref: {} },
          'yookassa'
        )
      );

      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('payment.failed', () => {
    it('marks the pending usage invoice failed when the charge key is present', async () => {
      const payload: NormalizedPaymentFailedPayload = {
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerSubscriptionId: 'sub_123',
        usageChargeKey: 'usage:sub-1:1780272000000'
      };
      const { reducer, manager } = await build({
        subscription: { id: 'sub-1' } as Subscription
      });

      await reducer.reduce(event('payment.failed', payload));

      expect(manager.update).toHaveBeenCalledWith(
        Invoice,
        {
          providerEventId: 'usage:sub-1:1780272000000',
          status: 'pending'
        },
        { status: 'failed' }
      );
    });

    it('emits PaymentFailed with the linked subscription id', async () => {
      const payload: NormalizedPaymentFailedPayload = {
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerSubscriptionId: 'sub_123'
      };
      const { reducer, emit } = await build({
        subscription: { id: 'sub-1' } as Subscription
      });

      await reducer.reduce(event('payment.failed', payload));

      expect(emit).toHaveBeenCalledWith(
        PaymentFailedEvent.name,
        expect.objectContaining({ userId: 'user-1', subscriptionId: 'sub-1' })
      );
    });

    it('fails the pending off-session invoice silently — the scheduler owns renewal dunning', async () => {
      const payload: NormalizedPaymentFailedPayload = {
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerSubscriptionId: null,
        offSessionChargeKey: 'renewal:sub-1:123:0'
      };
      const { reducer, manager, emit } = await build({
        subscription: { id: 'sub-1' } as Subscription,
        updateAffected: 1
      });

      await reducer.reduce(event('payment.failed', payload));

      // Without this flip a pending charge canceled at capture would keep the
      // invoice pending forever and never re-dun.
      expect(manager.update).toHaveBeenCalledWith(
        Invoice,
        { providerEventId: 'renewal:sub-1:123:0', status: 'pending' },
        { status: 'failed' }
      );
      // The renewal scan emits PaymentFailedEvent when it walks dunning; a
      // second one here would double-notify.
      expect(emit).not.toHaveBeenCalled();
    });

    it('performs every write inside a transaction, never on the bare manager', async () => {
      const offSession: NormalizedPaymentFailedPayload = {
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerSubscriptionId: null,
        offSessionChargeKey: 'renewal:sub-1:123:0'
      };
      const usage: NormalizedPaymentFailedPayload = {
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerSubscriptionId: 'sub_123',
        usageChargeKey: 'usage:sub-1:1780272000000'
      };

      for (const payload of [offSession, usage]) {
        const { reducer, bareManager, dataSource } = await build({
          subscription: { id: 'sub-1' } as Subscription,
          updateAffected: 1
        });

        await reducer.reduce(event('payment.failed', payload));

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(bareManager.update).not.toHaveBeenCalled();
        expect(bareManager.findOne).not.toHaveBeenCalled();
      }
    });
  });
});
