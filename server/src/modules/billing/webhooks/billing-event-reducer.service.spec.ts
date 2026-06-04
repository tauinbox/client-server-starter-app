import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Customer } from '../entities/customer.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PaymentFailedEvent,
  SubscriptionActivatedEvent,
  SubscriptionCanceledEvent,
  SubscriptionRenewedEvent
} from '../events/billing.events';
import type {
  NormalizedEvent,
  NormalizedInvoicePayload,
  NormalizedPaymentFailedPayload,
  NormalizedSubscriptionPayload
} from '../providers/payment-provider.interface';
import { BillingEventReducer } from './billing-event-reducer.service';

interface ManagerStubs {
  subscription: Subscription | null;
  plan: Plan | null;
  customer: Customer | null;
  invoiceInsertRows: Array<{ id: string }>;
}

function buildManager(stubs: ManagerStubs) {
  const save = jest.fn((entity: { id?: string }) =>
    Promise.resolve({ ...entity, id: entity.id ?? 'sub-new' })
  );
  const create = jest.fn((_entity: unknown, data: object) => ({ ...data }));
  const findOne = jest.fn((entity: unknown, _opts: unknown) => {
    if (entity === Subscription) return Promise.resolve(stubs.subscription);
    if (entity === Plan) return Promise.resolve(stubs.plan);
    if (entity === Customer) return Promise.resolve(stubs.customer);
    return Promise.resolve(null);
  });
  const execute = jest.fn().mockResolvedValue({ raw: stubs.invoiceInsertRows });
  const createQueryBuilder = jest.fn(() => ({
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute
  }));
  return { save, create, findOne, createQueryBuilder, execute };
}

async function build(stubs: Partial<ManagerStubs> = {}) {
  const manager = buildManager({
    subscription: null,
    plan: null,
    customer: null,
    invoiceInsertRows: [{ id: 'inv-1' }],
    ...stubs
  });
  const emit = jest.fn();
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    manager
  };

  const module = await Test.createTestingModule({
    providers: [
      BillingEventReducer,
      { provide: getDataSourceToken(), useValue: dataSource },
      { provide: EventEmitter2, useValue: { emit } }
    ]
  }).compile();

  return { reducer: module.get(BillingEventReducer), manager, emit };
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
  payload: unknown
): NormalizedEvent => ({
  provider: 'paddle',
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

  describe('payment.failed', () => {
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
  });
});
