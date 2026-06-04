import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  NotImplementedException,
  ServiceUnavailableException
} from '@nestjs/common';
import { EventName } from '@paddle/paddle-node-sdk';
import { PaddleProvider } from './paddle.provider';
import { PADDLE_CLIENT } from './paddle.client';
import type { Customer } from '../entities/customer.entity';
import type { Plan } from '../entities/plan.entity';
import type {
  NormalizedInvoicePayload,
  NormalizedSubscriptionPayload
} from './payment-provider.interface';

const WEBHOOK_SECRET = 'pdl_ntfset_whsec';

function paddleMock() {
  return {
    webhooks: { unmarshal: jest.fn() },
    transactions: { create: jest.fn(), get: jest.fn() },
    subscriptions: { cancel: jest.fn() },
    adjustments: { create: jest.fn() }
  };
}

type PaddleMock = ReturnType<typeof paddleMock>;

async function build(opts: {
  client?: PaddleMock | null;
  secret?: string;
}): Promise<{ provider: PaddleProvider; client: PaddleMock | null }> {
  const client = opts.client === undefined ? paddleMock() : opts.client;
  const module = await Test.createTestingModule({
    providers: [
      PaddleProvider,
      { provide: PADDLE_CLIENT, useValue: client },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            key === 'PADDLE_WEBHOOK_SECRET'
              ? (opts.secret ?? WEBHOOK_SECRET)
              : undefined
        }
      }
    ]
  }).compile();
  return { provider: module.get(PaddleProvider), client };
}

const subscriptionData = {
  id: 'sub_123',
  status: 'active',
  customData: { customerId: 'cust-1', userId: 'user-1', planKey: 'pro' },
  currentBillingPeriod: {
    startsAt: '2026-06-01T00:00:00Z',
    endsAt: '2026-07-01T00:00:00Z'
  },
  scheduledChange: null,
  items: [{ trialDates: null }]
};

const transactionData = {
  id: 'txn_123',
  status: 'completed',
  customData: { customerId: 'cust-1', userId: 'user-1' },
  subscriptionId: 'sub_123',
  currencyCode: 'USD',
  billingPeriod: {
    startsAt: '2026-06-01T00:00:00Z',
    endsAt: '2026-07-01T00:00:00Z'
  },
  billedAt: '2026-06-01T00:05:00Z',
  details: { totals: { total: '1200' }, lineItems: [{ id: 'txnitm_1' }] }
};

describe('PaddleProvider', () => {
  describe('verifyAndParseWebhook', () => {
    it('returns null when Paddle is not configured', async () => {
      const { provider } = await build({ client: null });
      const result = await provider.verifyAndParseWebhook(Buffer.from('{}'), {
        'paddle-signature': 'sig'
      });
      expect(result).toBeNull();
    });

    it('returns null when the signature header is absent', async () => {
      const { provider } = await build({});
      const result = await provider.verifyAndParseWebhook(
        Buffer.from('{}'),
        {}
      );
      expect(result).toBeNull();
    });

    it('returns null when unmarshal throws (invalid signature)', async () => {
      const { provider, client } = await build({});
      client!.webhooks.unmarshal.mockRejectedValue(new Error('bad signature'));
      const result = await provider.verifyAndParseWebhook(Buffer.from('{}'), {
        'paddle-signature': 'sig'
      });
      expect(result).toBeNull();
    });

    it('verifies with the raw body, secret and signature', async () => {
      const { provider, client } = await build({});
      client!.webhooks.unmarshal.mockResolvedValue({
        eventId: 'evt_1',
        eventType: EventName.SubscriptionActivated,
        data: subscriptionData
      });
      const raw = Buffer.from('{"event_id":"evt_1"}');

      await provider.verifyAndParseWebhook(raw, {
        'paddle-signature': ['sig-a', 'sig-b']
      });

      expect(client!.webhooks.unmarshal).toHaveBeenCalledWith(
        raw.toString('utf8'),
        WEBHOOK_SECRET,
        'sig-a'
      );
    });

    it.each([
      [EventName.SubscriptionActivated, 'subscription.activated'],
      [EventName.SubscriptionCreated, 'subscription.activated'],
      [EventName.SubscriptionUpdated, 'subscription.renewed'],
      [EventName.SubscriptionPastDue, 'subscription.past_due'],
      [EventName.SubscriptionCanceled, 'subscription.canceled']
    ])('maps %s to %s', async (eventType, expectedType) => {
      const { provider, client } = await build({});
      client!.webhooks.unmarshal.mockResolvedValue({
        eventId: 'evt_1',
        eventType,
        data: subscriptionData
      });

      const result = await provider.verifyAndParseWebhook(Buffer.from('{}'), {
        'paddle-signature': 'sig'
      });

      expect(result).toMatchObject({
        provider: 'paddle',
        providerEventId: 'evt_1',
        type: expectedType
      });
      const payload = result!.payload as NormalizedSubscriptionPayload;
      expect(payload).toMatchObject({
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerSubscriptionId: 'sub_123',
        status: 'active',
        planKey: 'pro',
        currentPeriodStart: '2026-06-01T00:00:00Z',
        currentPeriodEnd: '2026-07-01T00:00:00Z',
        cancelAtPeriodEnd: false
      });
    });

    it('flags cancelAtPeriodEnd from a scheduled cancel', async () => {
      const { provider, client } = await build({});
      client!.webhooks.unmarshal.mockResolvedValue({
        eventId: 'evt_1',
        eventType: EventName.SubscriptionUpdated,
        data: { ...subscriptionData, scheduledChange: { action: 'cancel' } }
      });

      const result = await provider.verifyAndParseWebhook(Buffer.from('{}'), {
        'paddle-signature': 'sig'
      });

      const payload = result!.payload as NormalizedSubscriptionPayload;
      expect(payload.cancelAtPeriodEnd).toBe(true);
    });

    it('maps transaction.completed to invoice.paid', async () => {
      const { provider, client } = await build({});
      client!.webhooks.unmarshal.mockResolvedValue({
        eventId: 'evt_2',
        eventType: EventName.TransactionCompleted,
        data: transactionData
      });

      const result = await provider.verifyAndParseWebhook(Buffer.from('{}'), {
        'paddle-signature': 'sig'
      });

      expect(result).toMatchObject({ type: 'invoice.paid' });
      const payload = result!.payload as NormalizedInvoicePayload;
      expect(payload).toMatchObject({
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerInvoiceRef: 'txn_123',
        providerSubscriptionId: 'sub_123',
        amountMinor: 1200,
        currency: 'USD',
        paidAt: '2026-06-01T00:05:00Z'
      });
    });

    it('maps transaction.payment_failed to payment.failed', async () => {
      const { provider, client } = await build({});
      client!.webhooks.unmarshal.mockResolvedValue({
        eventId: 'evt_3',
        eventType: EventName.TransactionPaymentFailed,
        data: transactionData
      });

      const result = await provider.verifyAndParseWebhook(Buffer.from('{}'), {
        'paddle-signature': 'sig'
      });

      expect(result).toMatchObject({
        type: 'payment.failed',
        payload: { providerSubscriptionId: 'sub_123' }
      });
    });

    it('returns null for an event type it does not reduce', async () => {
      const { provider, client } = await build({});
      client!.webhooks.unmarshal.mockResolvedValue({
        eventId: 'evt_4',
        eventType: EventName.SubscriptionPaused,
        data: subscriptionData
      });

      const result = await provider.verifyAndParseWebhook(Buffer.from('{}'), {
        'paddle-signature': 'sig'
      });

      expect(result).toBeNull();
    });
  });

  describe('startCheckout', () => {
    const customer = {
      id: 'cust-1',
      userId: 'user-1',
      providerCustomerId: null
    } as Customer;
    const plan = {
      key: 'pro',
      prices: {
        paddle: { currency: 'USD', amountMinor: 1200, providerPriceId: 'pri_1' }
      }
    } as Plan;

    it('creates a transaction and returns the checkout url + session ref', async () => {
      const { provider, client } = await build({});
      client!.transactions.create.mockResolvedValue({
        id: 'txn_new',
        checkout: { url: 'https://pay.paddle.com/checkout/txn_new' }
      });

      const session = await provider.startCheckout(customer, plan, {
        successUrl: 'https://app/return',
        cancelUrl: 'https://app/cancel'
      });

      expect(client!.transactions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [{ priceId: 'pri_1', quantity: 1 }],
          customData: { customerId: 'cust-1', userId: 'user-1', planKey: 'pro' }
        })
      );
      expect(session).toEqual({
        url: 'https://pay.paddle.com/checkout/txn_new',
        sessionRef: 'txn_new'
      });
    });

    it('throws when the plan has no Paddle price configured', async () => {
      const { provider } = await build({});
      const planNoPrice = { key: 'pro', prices: {} } as Plan;
      await expect(
        provider.startCheckout(customer, planNoPrice, {
          successUrl: 'https://app/return',
          cancelUrl: 'https://app/cancel'
        })
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('cancel', () => {
    it.each([
      ['period_end', 'next_billing_period'],
      ['immediate', 'immediately']
    ] as const)(
      'maps %s mode to effectiveFrom %s',
      async (mode, effectiveFrom) => {
        const { provider, client } = await build({});
        client!.subscriptions.cancel.mockResolvedValue({});

        await provider.cancel('sub_123', mode);

        expect(client!.subscriptions.cancel).toHaveBeenCalledWith('sub_123', {
          effectiveFrom
        });
      }
    );
  });

  describe('refund', () => {
    it('issues a full refund when the amount covers the transaction total', async () => {
      const { provider, client } = await build({});
      client!.transactions.get.mockResolvedValue({
        details: { totals: { total: '1200' }, lineItems: [{ id: 'txnitm_1' }] }
      });

      await provider.refund('txn_123', 1200);

      expect(client!.adjustments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: 'txn_123',
          action: 'refund',
          type: 'full'
        })
      );
    });

    it('issues a partial refund against the line item for a lesser amount', async () => {
      const { provider, client } = await build({});
      client!.transactions.get.mockResolvedValue({
        details: { totals: { total: '1200' }, lineItems: [{ id: 'txnitm_1' }] }
      });

      await provider.refund('txn_123', 500);

      expect(client!.adjustments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: 'txn_123',
          action: 'refund',
          type: 'partial',
          items: [{ itemId: 'txnitm_1', type: 'partial', amount: '500' }]
        })
      );
    });
  });

  describe('ensureCustomer', () => {
    it('returns an existing provider customer id', async () => {
      const { provider } = await build({});
      const id = await provider.ensureCustomer({
        providerCustomerId: 'ctm_existing'
      } as Customer);
      expect(id).toBe('ctm_existing');
    });

    it('is not implemented when no provider customer exists (created at checkout)', async () => {
      const { provider } = await build({});
      expect(() =>
        provider.ensureCustomer({ providerCustomerId: null } as Customer)
      ).toThrow(NotImplementedException);
    });
  });
});
