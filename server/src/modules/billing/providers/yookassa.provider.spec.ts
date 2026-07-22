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
    getPaymentList: jest.fn(),
    createRefund: jest.fn()
  };
}

type YooMock = ReturnType<typeof yooMock>;

const USER_EMAIL = 'buyer@example.com';

const SAVED_METHOD_REF = 'pm-token';

async function build(
  opts: { client?: YooMock | null; vatCode?: string } = {}
): Promise<{
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
          get: (key: string) =>
            key === 'YOOKASSA_VAT_CODE' ? (opts.vatCode ?? '1') : undefined
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
  describe('constructor VAT code guard', () => {
    // Regression: the pre-fix code put NaN (or any out-of-range value)
    // straight into the 54-FZ receipt vat_code.
    it('rejects a non-numeric YOOKASSA_VAT_CODE', async () => {
      await expect(build({ vatCode: 'not-a-number' })).rejects.toThrow(
        'YOOKASSA_VAT_CODE'
      );
    });

    it('rejects an out-of-range YOOKASSA_VAT_CODE', async () => {
      await expect(build({ vatCode: '0' })).rejects.toThrow(
        'YOOKASSA_VAT_CODE'
      );
      await expect(build({ vatCode: '7' })).rejects.toThrow(
        'YOOKASSA_VAT_CODE'
      );
    });

    it('accepts a valid YOOKASSA_VAT_CODE', async () => {
      const { provider } = await build({ vatCode: '6' });
      expect(provider).toBeDefined();
    });
  });

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

  describe('updatePaymentMethod', () => {
    it('re-binds the card with a zero-amount payment, no receipt, and the method-update marker', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-mu',
        status: 'pending',
        confirmation: { confirmation_url: 'https://yoomoney/checkout/pay-mu' }
      });

      const session = await provider.updatePaymentMethod(null, customer, urls);

      const [payload, idempotencyKey] = client!.createPayment.mock.calls[0] as [
        ICreatePayment,
        string
      ];
      expect(payload).toMatchObject({
        amount: { value: '0.00', currency: 'RUB' },
        capture: true,
        save_payment_method: true,
        confirmation: { type: 'redirect', return_url: urls.successUrl },
        metadata: {
          customerId: 'cust-1',
          userId: 'user-1',
          purpose: 'method_update'
        },
        merchant_customer_id: 'cust-1'
      });
      expect(payload.receipt).toBeUndefined();
      expect(typeof idempotencyKey).toBe('string');
      expect(session).toEqual({
        url: 'https://yoomoney/checkout/pay-mu',
        sessionRef: 'pay-mu'
      });
    });

    it('throws when YooKassa returns no confirmation url', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-mu',
        confirmation: {}
      });
      await expect(
        provider.updatePaymentMethod(null, customer, urls)
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('throws when YooKassa is not configured', async () => {
      const { provider } = await build({ client: null });
      await expect(
        provider.updatePaymentMethod(null, customer, urls)
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('createOneTimePayment', () => {
    const params = {
      amountMinor: 50000,
      currency: 'RUB',
      description: 'Pro report pack',
      receiptItems: [
        { description: 'Pro report pack', amountMinor: 50000, quantity: 1 }
      ],
      productId: 'prod-1',
      urls
    };

    it('creates a plain payment with a receipt and the one-time marker, without saving the card', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-ot',
        status: 'pending',
        confirmation: { confirmation_url: 'https://yoomoney/checkout/pay-ot' }
      });

      const session = await provider.createOneTimePayment(customer, params);

      const [payload, idempotencyKey] = client!.createPayment.mock.calls[0] as [
        ICreatePayment,
        string
      ];
      expect(payload).toMatchObject({
        amount: { value: '500.00', currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: urls.successUrl },
        description: 'Pro report pack',
        metadata: {
          customerId: 'cust-1',
          userId: 'user-1',
          purpose: 'one_time',
          productId: 'prod-1'
        },
        merchant_customer_id: 'cust-1'
      });
      expect(payload.save_payment_method).toBeUndefined();
      expect(payload.receipt!.items[0]).toMatchObject({
        description: 'Pro report pack',
        quantity: '1',
        amount: { value: '500.00', currency: 'RUB' },
        vat_code: 1
      });
      expect(typeof idempotencyKey).toBe('string');
      expect(session).toEqual({
        url: 'https://yoomoney/checkout/pay-ot',
        sessionRef: 'pay-ot'
      });
    });

    it('throws when YooKassa returns no confirmation url', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-ot',
        confirmation: {}
      });
      await expect(
        provider.createOneTimePayment(customer, params)
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('throws when YooKassa is not configured', async () => {
      const { provider } = await build({ client: null });
      await expect(
        provider.createOneTimePayment(customer, params)
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
      expect(result).toEqual({
        providerInvoiceRef: 'pay-4',
        status: 'captured'
      });
    });

    it('formats a large minor amount without float drift (bigint money path)', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-big',
        status: 'succeeded'
      });

      // 2_500_000_000 minor exceeds the old int32 ceiling; the bigint Money path
      // formats it with integer-string math, never `(amount / 100).toFixed`.
      await provider.chargeOffSession(
        savedCustomer,
        2_500_000_000,
        [{ description: 'Bulk', amountMinor: 2_500_000_000, quantity: 1 }],
        'idem-big'
      );

      const [payload] = client!.createPayment.mock.calls[0] as [ICreatePayment];
      expect(payload.amount.value).toBe('25000000.00');
      expect(payload.receipt!.items[0].amount.value).toBe('25000000.00');
    });

    it('formats the amount at the currency scale, not a fixed two decimals', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-jpy',
        status: 'succeeded'
      });

      // JPY has no minor unit: 1500 minor is 1500 yen. A hardcoded scale of 2
      // would send '15.00' and undercharge by two orders of magnitude.
      await provider.chargeOffSession(
        { ...savedCustomer, currency: 'JPY' } as Customer,
        1500,
        [{ description: 'Pro renewal', amountMinor: 1500, quantity: 1 }],
        'idem-jpy'
      );

      const [payload] = client!.createPayment.mock.calls[0] as [ICreatePayment];
      expect(payload.amount).toEqual({ value: '1500', currency: 'JPY' });
      expect(payload.receipt!.items[0].amount).toEqual({
        value: '1500',
        currency: 'JPY'
      });
    });

    it('reports a pending (payment-after-receipt) charge as accepted but uncaptured', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-5',
        status: 'pending'
      });

      await expect(
        provider.chargeOffSession(savedCustomer, 99000, items)
      ).resolves.toEqual({ providerInvoiceRef: 'pay-5', status: 'pending' });
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

    it('stamps the off-session marker carrying the invoice key so the webhook is reconcilable', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-8',
        status: 'succeeded'
      });

      await provider.chargeOffSession(
        savedCustomer,
        99000,
        items,
        'renewal:sub-1:123'
      );

      const [payload] = client!.createPayment.mock.calls[0] as [ICreatePayment];
      expect(payload.metadata).toMatchObject({
        customerId: 'cust-1',
        userId: 'user-1',
        purpose: 'off_session',
        chargeKey: 'renewal:sub-1:123'
      });
    });

    it('omits the off-session marker when no idempotency key is supplied', async () => {
      const { provider, client } = await build();
      client!.createPayment.mockResolvedValue({
        id: 'pay-9',
        status: 'succeeded'
      });

      await provider.chargeOffSession(savedCustomer, 99000, items);

      const [payload] = client!.createPayment.mock.calls[0] as [ICreatePayment];
      expect(payload.metadata).not.toHaveProperty('purpose');
      expect(payload.metadata).not.toHaveProperty('chargeKey');
    });
  });

  describe('findOffSessionCharge', () => {
    const CHARGE_KEY = 'renewal:sub-1:123';
    const CREATED_AFTER = new Date('2026-06-01T00:00:00Z');
    const offSession = (
      id: string,
      status: string,
      chargeKey = CHARGE_KEY
    ) => ({
      id,
      status,
      metadata: { purpose: 'off_session', chargeKey }
    });

    it('returns the non-canceled payment matching the charge key', async () => {
      const { provider, client } = await build();
      client!.getPaymentList.mockResolvedValue({
        items: [
          offSession('pay-other', 'succeeded', 'renewal:sub-9:456'),
          { id: 'pay-plain', status: 'succeeded', metadata: {} },
          offSession('pay-hit', 'succeeded')
        ]
      });

      await expect(
        provider.findOffSessionCharge(CHARGE_KEY, CREATED_AFTER)
      ).resolves.toEqual({ providerInvoiceRef: 'pay-hit', status: 'captured' });
      expect(client!.getPaymentList).toHaveBeenCalledWith({
        created_at: { value: CREATED_AFTER.toISOString(), mode: 'gte' },
        limit: 100
      });
    });

    it('ignores a canceled attempt (a hard decline legitimately re-charges)', async () => {
      const { provider, client } = await build();
      client!.getPaymentList.mockResolvedValue({
        items: [offSession('pay-declined', 'canceled')]
      });

      await expect(
        provider.findOffSessionCharge(CHARGE_KEY, CREATED_AFTER)
      ).resolves.toBeNull();
    });

    it('follows the cursor to a match on a later page', async () => {
      const { provider, client } = await build();
      client!.getPaymentList
        .mockResolvedValueOnce({ items: [], next_cursor: 'cur-2' })
        .mockResolvedValueOnce({
          items: [offSession('pay-deep', 'succeeded')]
        });

      await expect(
        provider.findOffSessionCharge(CHARGE_KEY, CREATED_AFTER)
      ).resolves.toEqual({
        providerInvoiceRef: 'pay-deep',
        status: 'captured'
      });
      expect(client!.getPaymentList).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cursor: 'cur-2' })
      );
    });

    it('returns null when the scan exhausts without a match', async () => {
      const { provider, client } = await build();
      client!.getPaymentList.mockResolvedValue({ items: [] });

      await expect(
        provider.findOffSessionCharge(CHARGE_KEY, CREATED_AFTER)
      ).resolves.toBeNull();
    });

    it('fails loudly instead of green-lighting a charge when the page cap is hit', async () => {
      const { provider, client } = await build();
      client!.getPaymentList.mockResolvedValue({
        items: [],
        next_cursor: 'more'
      });

      await expect(
        provider.findOffSessionCharge(CHARGE_KEY, CREATED_AFTER)
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(client!.getPaymentList).toHaveBeenCalledTimes(20);
    });

    it('throws when YooKassa is not configured', async () => {
      const { provider } = await build({ client: null });
      await expect(
        provider.findOffSessionCharge(CHARGE_KEY, CREATED_AFTER)
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

    it('parses a large refund amount exactly on the round-trip (bigint money path)', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-big',
        amount: { value: '25000000.00', currency: 'RUB' },
        description: 'Bulk',
        metadata: { userId: 'user-1' }
      });
      client!.createRefund.mockResolvedValue({ id: 'ref-big' });

      // amount 0 → refund the whole payment: the decimal is parsed to minor and
      // re-formatted. A float parse would drift; the bigint Money path round-trips.
      await provider.refund('pay-big', 0);

      const [payload] = client!.createRefund.mock.calls[0] as [ICreateRefund];
      expect(payload.amount).toEqual({ value: '25000000.00', currency: 'RUB' });
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

    it('parses the webhook amount at the currency scale', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-jpy',
        status: 'succeeded',
        amount: { value: '1500', currency: 'JPY' },
        captured_at: '2026-06-01T00:05:00Z',
        created_at: '2026-06-01T00:00:00Z',
        metadata: { customerId: 'cust-1', userId: 'user-1', planKey: 'pro' }
      });

      const result = await provider.verifyAndParseWebhook(
        notification('payment.succeeded')
      );

      // A fixed scale of 2 would reject '1500' as unparseable-with-decimals or
      // read it as 150000 minor; the currency scale keeps it 1500.
      const payload = result!.payload as NormalizedInvoicePayload;
      expect(payload).toMatchObject({ amountMinor: 1500, currency: 'JPY' });
    });

    it('maps a succeeded method-update re-bind to payment_method.updated', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-mu',
        status: 'succeeded',
        amount: { value: '0.00', currency: 'RUB' },
        payment_method: {
          id: 'tok-new',
          saved: true,
          card: { card_type: 'MasterCard', last4: '4444' }
        },
        metadata: {
          customerId: 'cust-1',
          userId: 'user-1',
          purpose: 'method_update'
        }
      });

      const result = await provider.verifyAndParseWebhook(
        notification('payment.succeeded', 'pay-mu')
      );

      expect(result).toMatchObject({
        provider: 'yookassa',
        providerEventId: 'payment.succeeded:pay-mu',
        type: 'payment_method.updated',
        payload: {
          ref: { customerId: 'cust-1', userId: 'user-1' },
          savedPaymentMethod: {
            providerMethodRef: 'tok-new',
            brand: 'MasterCard',
            last4: '4444'
          }
        }
      });
    });

    it('ignores a canceled method-update re-bind (no payment.failed)', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-mu',
        status: 'canceled',
        amount: { value: '0.00', currency: 'RUB' },
        metadata: { customerId: 'cust-1', purpose: 'method_update' }
      });

      expect(
        await provider.verifyAndParseWebhook(
          notification('payment.canceled', 'pay-mu')
        )
      ).toBeNull();
    });

    it('maps a succeeded one-time purchase to invoice.paid with kind + product id and no saved method', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-ot',
        status: 'succeeded',
        amount: { value: '500.00', currency: 'RUB' },
        captured_at: '2026-06-11T10:00:00Z',
        payment_method: {
          id: 'tok-stray',
          saved: true,
          card: { card_type: 'Visa', last4: '1111' }
        },
        metadata: {
          customerId: 'cust-1',
          userId: 'user-1',
          purpose: 'one_time',
          productId: 'prod-1'
        }
      });

      const result = await provider.verifyAndParseWebhook(
        notification('payment.succeeded', 'pay-ot')
      );

      expect(result).toMatchObject({ type: 'invoice.paid' });
      const payload = result!.payload as NormalizedInvoicePayload;
      expect(payload).toMatchObject({
        kind: 'one_time',
        productId: 'prod-1',
        providerSubscriptionId: null,
        amountMinor: 50000
      });
      // A one-time purchase never persists a payment method, even if the
      // provider reports the card as saved.
      expect(payload.savedPaymentMethod).toBeNull();
    });

    it('ignores a canceled one-time purchase (nothing pending to fail)', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-ot',
        status: 'canceled',
        amount: { value: '500.00', currency: 'RUB' },
        metadata: { customerId: 'cust-1', purpose: 'one_time' }
      });

      expect(
        await provider.verifyAndParseWebhook(
          notification('payment.canceled', 'pay-ot')
        )
      ).toBeNull();
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

    it('maps a succeeded off-session charge to invoice.paid with the reconcile key and no saved method', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-os',
        status: 'succeeded',
        amount: { value: '990.00', currency: 'RUB' },
        captured_at: '2026-06-08T00:01:00Z',
        payment_method: {
          id: 'tok-x',
          saved: true,
          card: { card_type: 'Visa', last4: '4242' }
        },
        metadata: {
          customerId: 'cust-1',
          userId: 'user-1',
          purpose: 'off_session',
          chargeKey: 'renewal:sub-1:123:0'
        }
      });

      const result = await provider.verifyAndParseWebhook(
        notification('payment.succeeded', 'pay-os')
      );

      expect(result).toMatchObject({ type: 'invoice.paid' });
      const payload = result!.payload as NormalizedInvoicePayload;
      expect(payload.offSessionChargeKey).toBe('renewal:sub-1:123:0');
      expect(payload.providerInvoiceRef).toBe('pay-os');
      // The card is already saved from the first payment; a renewal must not
      // re-persist it.
      expect(payload.savedPaymentMethod).toBeNull();
    });

    it('maps a canceled off-session charge to payment.failed with the reconcile key', async () => {
      const { provider, client } = await build();
      client!.getPayment.mockResolvedValue({
        id: 'pay-os',
        status: 'canceled',
        amount: { value: '990.00', currency: 'RUB' },
        metadata: {
          customerId: 'cust-1',
          userId: 'user-1',
          purpose: 'off_session',
          chargeKey: 'renewal:sub-1:123:0'
        }
      });

      // A pending charge later declined at capture must surface, so the core
      // can fail the pending invoice instead of leaving it paid forever.
      const result = await provider.verifyAndParseWebhook(
        notification('payment.canceled', 'pay-os')
      );

      expect(result).toMatchObject({
        type: 'payment.failed',
        payload: {
          providerSubscriptionId: null,
          offSessionChargeKey: 'renewal:sub-1:123:0',
          ref: { customerId: 'cust-1', userId: 'user-1' }
        }
      });
    });
  });
});
