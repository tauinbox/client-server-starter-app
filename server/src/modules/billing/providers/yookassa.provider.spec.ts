import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ICreatePayment, ICreateRefund } from '@a2seven/yoo-checkout';
import { User } from '../../users/entities/user.entity';
import { YooKassaProvider } from './yookassa.provider';
import { YOOKASSA_CLIENT } from './yookassa.client';
import { PaymentMethod } from '../entities/payment-method.entity';
import type { Customer } from '../entities/customer.entity';
import type { Plan } from '../entities/plan.entity';
import type {
  NormalizedInvoicePayload,
  ReceiptItem
} from './payment-provider.interface';

function yooMock() {
  return {
    createPayment: jest.fn(),
    getPayment: jest.fn(),
    createRefund: jest.fn()
  };
}

type YooMock = ReturnType<typeof yooMock>;

const USER_EMAIL = 'buyer@example.com';

const SAVED_METHOD_REF = 'pm-token';

async function build(opts: { client?: YooMock | null } = {}): Promise<{
  provider: YooKassaProvider;
  client: YooMock | null;
  users: { findOne: jest.Mock };
  paymentMethods: { findOne: jest.Mock };
}> {
  const client = opts.client === undefined ? yooMock() : opts.client;
  const users = { findOne: jest.fn().mockResolvedValue({ email: USER_EMAIL }) };
  const paymentMethods = {
    findOne: jest
      .fn()
      .mockResolvedValue({ providerMethodRef: SAVED_METHOD_REF })
  };
  const module = await Test.createTestingModule({
    providers: [
      YooKassaProvider,
      { provide: YOOKASSA_CLIENT, useValue: client },
      { provide: getRepositoryToken(User), useValue: users },
      { provide: getRepositoryToken(PaymentMethod), useValue: paymentMethods },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => (key === 'YOOKASSA_VAT_CODE' ? '1' : undefined)
        }
      }
    ]
  }).compile();
  return {
    provider: module.get(YooKassaProvider),
    client,
    users,
    paymentMethods
  };
}

const customer = {
  id: 'cust-1',
  userId: 'user-1',
  currency: 'RUB',
  providerCustomerId: null
} as Customer;

const paidPlan = {
  key: 'pro',
  name: 'Pro',
  trialDays: 0,
  prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
} as Plan;

const urls = {
  successUrl: 'https://app/return',
  cancelUrl: 'https://app/cancel'
};

describe('YooKassaProvider', () => {
  describe('ensureCustomer', () => {
    it('returns the existing provider customer id when present', async () => {
      const { provider } = await build();
      await expect(
        provider.ensureCustomer({ providerCustomerId: 'pm-1' } as Customer)
      ).resolves.toBe('pm-1');
    });

    it('falls back to the billing customer id (no YooKassa customer object)', async () => {
      const { provider } = await build();
      await expect(provider.ensureCustomer(customer)).resolves.toBe('cust-1');
    });
  });

  describe('startCheckout', () => {
    it('creates a paid first payment with a 54-FZ receipt and returns the redirect url', async () => {
      const { provider, client, users } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-1',
        status: 'pending',
        confirmation: { confirmation_url: 'https://yoomoney/checkout/pay-1' }
      });

      const session = await provider.startCheckout(customer, paidPlan, urls);

      const [payload, idempotencyKey] = client!.createPayment.mock.calls[0] as [
        ICreatePayment,
        string
      ];
      expect(payload).toMatchObject({
        amount: { value: '990.00', currency: 'RUB' },
        capture: true,
        save_payment_method: true,
        confirmation: { type: 'redirect', return_url: urls.successUrl },
        description: 'Pro',
        metadata: { customerId: 'cust-1', userId: 'user-1', planKey: 'pro' },
        merchant_customer_id: 'cust-1'
      });
      expect(payload.receipt).toEqual({
        customer: { email: USER_EMAIL },
        email: USER_EMAIL,
        items: [
          {
            description: 'Pro',
            quantity: '1',
            amount: { value: '990.00', currency: 'RUB' },
            vat_code: 1
          }
        ]
      });
      expect(users.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { email: true }
      });
      expect(typeof idempotencyKey).toBe('string');
      expect(session).toEqual({
        url: 'https://yoomoney/checkout/pay-1',
        sessionRef: 'pay-1'
      });
    });

    it('binds the card with a zero-amount payment and no receipt for a trial plan', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-2',
        status: 'pending',
        confirmation: { confirmation_url: 'https://yoomoney/checkout/pay-2' }
      });

      await provider.startCheckout(
        customer,
        { ...paidPlan, trialDays: 14 } as Plan,
        urls
      );

      const [payload] = client!.createPayment.mock.calls[0] as [ICreatePayment];
      expect(payload.amount).toEqual({ value: '0.00', currency: 'RUB' });
      expect(payload.save_payment_method).toBe(true);
      expect(payload.receipt).toBeUndefined();
    });

    it('throws when the plan has no YooKassa price', async () => {
      const { provider } = await build();
      await expect(
        provider.startCheckout(
          customer,
          { ...paidPlan, prices: {} } as Plan,
          urls
        )
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('throws when YooKassa returns no confirmation url', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-3',
        confirmation: {}
      });
      await expect(
        provider.startCheckout(customer, paidPlan, urls)
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('throws when YooKassa is not configured', async () => {
      const { provider } = await build({ client: null });
      await expect(
        provider.startCheckout(customer, paidPlan, urls)
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('chargeOffSession', () => {
    const savedCustomer = {
      ...customer,
      defaultPaymentMethodId: 'pmrow-1'
    } as Customer;
    const items: ReceiptItem[] = [
      { description: 'Pro renewal', amountMinor: 99000, quantity: 1 }
    ];

    it('charges the saved method with a receipt and forwards the idempotency key', async () => {
      const { provider, client, paymentMethods } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-4',
        status: 'succeeded'
      });

      const result = await provider.chargeOffSession(
        savedCustomer,
        99000,
        items,
        'idem-key-1'
      );

      expect(paymentMethods.findOne).toHaveBeenCalledWith({
        where: { id: 'pmrow-1' }
      });
      const [payload, idempotencyKey] = client!.createPayment.mock.calls[0] as [
        ICreatePayment,
        string
      ];
      expect(payload).toMatchObject({
        amount: { value: '990.00', currency: 'RUB' },
        capture: true,
        payment_method_id: SAVED_METHOD_REF,
        merchant_customer_id: 'cust-1'
      });
      expect(payload.receipt!.items[0]).toMatchObject({
        description: 'Pro renewal',
        quantity: '1',
        amount: { value: '990.00', currency: 'RUB' },
        vat_code: 1
      });
      expect(idempotencyKey).toBe('idem-key-1');
      expect(result).toEqual({ providerInvoiceRef: 'pay-4' });
    });

    it('treats a pending (payment-after-receipt) charge as accepted', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-5',
        status: 'pending'
      });

      await expect(
        provider.chargeOffSession(savedCustomer, 99000, items)
      ).resolves.toEqual({ providerInvoiceRef: 'pay-5' });
    });

    it('throws when the charge is declined (canceled)', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-6',
        status: 'canceled'
      });

      await expect(
        provider.chargeOffSession(savedCustomer, 99000, items)
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('generates an idempotency key when the caller omits one', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-7',
        status: 'succeeded'
      });

      await provider.chargeOffSession(savedCustomer, 99000, items);

      const [, idempotencyKey] = client!.createPayment.mock.calls[0] as [
        ICreatePayment,
        string
      ];
      expect(typeof idempotencyKey).toBe('string');
      expect(idempotencyKey.length).toBeGreaterThan(0);
    });

    it('throws when the customer has no saved payment method', async () => {
      const { provider } = await build();
      await expect(
        provider.chargeOffSession(customer, 99000, items)
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('throws when the saved payment method row is missing', async () => {
      const { provider, paymentMethods } = await build();
      paymentMethods.findOne.mockResolvedValue(null);
      await expect(
        provider.chargeOffSession(savedCustomer, 99000, items)
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('cancel', () => {
    it('is a no-op (self-managed lifecycle)', async () => {
      const { provider } = await build();
      await expect(
        provider.cancel('sub-x', 'period_end')
      ).resolves.toBeUndefined();
    });
  });

  describe('refund', () => {
    it('re-fetches the payment and refunds the given amount with a refund receipt', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-8',
        amount: { value: '990.00', currency: 'RUB' },
        description: 'Pro',
        metadata: { userId: 'user-1' }
      });
      client!.createRefund.mockResolvedValue({ id: 'ref-1' });

      await provider.refund('pay-8', 50000, 'idem-refund-1');

      const [payload, idempotencyKey] = client!.createRefund.mock.calls[0] as [
        ICreateRefund,
        string
      ];
      expect(payload).toMatchObject({
        payment_id: 'pay-8',
        amount: { value: '500.00', currency: 'RUB' }
      });
      expect(payload.receipt!.items[0]).toMatchObject({
        description: 'Pro',
        amount: { value: '500.00', currency: 'RUB' },
        vat_code: 1
      });
      expect(payload.receipt!.email).toBe(USER_EMAIL);
      expect(idempotencyKey).toBe('idem-refund-1');
    });

    it('refunds the full payment amount when amount is zero', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-9',
        amount: { value: '990.00', currency: 'RUB' },
        description: 'Pro',
        metadata: { userId: 'user-1' }
      });
      client!.createRefund.mockResolvedValue({ id: 'ref-2' });

      await provider.refund('pay-9', 0);

      const [payload] = client!.createRefund.mock.calls[0] as [ICreateRefund];
      expect(payload.amount).toEqual({ value: '990.00', currency: 'RUB' });
    });
  });

  describe('verifyAndParseWebhook', () => {
    function notification(event: string, id = 'pay-w'): Buffer {
      return Buffer.from(
        JSON.stringify({ type: 'notification', event, object: { id } })
      );
    }

    it('returns null when YooKassa is not configured', async () => {
      const { provider } = await build({ client: null });
      expect(
        await provider.verifyAndParseWebhook(notification('payment.succeeded'))
      ).toBeNull();
    });

    it('returns null for an unparseable body', async () => {
      const { provider } = await build();
      expect(
        await provider.verifyAndParseWebhook(Buffer.from('not-json'))
      ).toBeNull();
    });

    it('returns null when the event or object id is missing', async () => {
      const { provider } = await build();
      expect(
        await provider.verifyAndParseWebhook(
          Buffer.from(JSON.stringify({ event: 'payment.succeeded' }))
        )
      ).toBeNull();
    });

    it('ignores events it does not reduce', async () => {
      const { provider, client } = await build();
      expect(
        await provider.verifyAndParseWebhook(notification('refund.succeeded'))
      ).toBeNull();
      expect(client!.getPayment).not.toHaveBeenCalled();
    });

    it('re-fetches the payment and maps a succeeded payment to invoice.paid', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-w',
        status: 'succeeded',
        amount: { value: '990.00', currency: 'RUB' },
        captured_at: '2026-06-01T00:05:00Z',
        created_at: '2026-06-01T00:00:00Z',
        metadata: { customerId: 'cust-1', userId: 'user-1', planKey: 'pro' }
      });

      const result = await provider.verifyAndParseWebhook(
        notification('payment.succeeded')
      );

      expect(client!.getPayment).toHaveBeenCalledWith('pay-w');
      expect(result).toMatchObject({
        provider: 'yookassa',
        providerEventId: 'payment.succeeded:pay-w',
        type: 'invoice.paid'
      });
      const payload = result!.payload as NormalizedInvoicePayload;
      expect(payload).toMatchObject({
        ref: { customerId: 'cust-1', userId: 'user-1' },
        providerInvoiceRef: 'pay-w',
        providerSubscriptionId: null,
        amountMinor: 99000,
        currency: 'RUB',
        paidAt: '2026-06-01T00:05:00Z'
      });
    });

    it('maps a canceled payment to payment.failed', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-w',
        status: 'canceled',
        amount: { value: '990.00', currency: 'RUB' },
        metadata: { customerId: 'cust-1', userId: 'user-1' }
      });

      const result = await provider.verifyAndParseWebhook(
        notification('payment.canceled')
      );

      expect(result).toMatchObject({
        type: 'payment.failed',
        payload: { providerSubscriptionId: null }
      });
    });

    it('returns null for a non-terminal re-fetched status', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-w',
        status: 'pending',
        amount: { value: '990.00', currency: 'RUB' },
        metadata: {}
      });

      expect(
        await provider.verifyAndParseWebhook(notification('payment.succeeded'))
      ).toBeNull();
    });

    it('returns null when the re-fetch throws', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockRejectedValue(new Error('network'));

      expect(
        await provider.verifyAndParseWebhook(notification('payment.succeeded'))
      ).toBeNull();
    });
  });
});
