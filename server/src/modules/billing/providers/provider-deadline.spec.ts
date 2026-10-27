import { ErrorKeys } from '@app/shared/constants';
import { expectApiError } from '../../../common/testing/api-error.expect';
import type { Customer } from '../entities/customer.entity';
import type { Plan } from '../entities/plan.entity';
import {
  ChargeDeclinedError,
  type PaymentProvider
} from './payment-provider.interface';
import {
  DeadlineBoundProvider,
  ProviderError,
  ProviderTimeoutError,
  withProviderDeadline
} from './provider-deadline';

const TIMEOUT_MS = 20;

function providerStub() {
  return {
    id: 'yookassa',
    managesLifecycle: false,
    startCheckout: jest.fn(),
    chargeOffSession: jest.fn(),
    findOffSessionCharge: jest.fn(),
    getOffSessionCharge: jest.fn(),
    createOneTimePayment: jest.fn(),
    chargeUsage: jest.fn(),
    changePlan: jest.fn(),
    previewChangePlan: jest.fn(),
    updatePaymentMethod: jest.fn(),
    cancel: jest.fn(),
    refund: jest.fn(),
    verifyAndParseWebhook: jest.fn()
  } satisfies PaymentProvider;
}

const customer = { id: 'cust-1', userId: 'user-1' } as Customer;
const plan = { key: 'pro' } as Plan;
const urls = { successUrl: 'https://app/ok', cancelUrl: 'https://app/no' };

/** A call that never settles — the stalled socket this wrapper exists for. */
const hangs = (): Promise<never> => new Promise<never>(() => {});

describe('withProviderDeadline', () => {
  it('rejects a call that outlives the deadline, naming provider and method', async () => {
    const inner = providerStub();
    inner.startCheckout.mockImplementation(hangs);
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    await expect(
      provider.startCheckout(customer, plan, urls, true)
    ).rejects.toThrow(
      new ProviderTimeoutError('yookassa', 'startCheckout', TIMEOUT_MS)
    );
  });

  it('answers a gateway timeout, since the provider did not answer in time', () => {
    const error = new ProviderTimeoutError(
      'yookassa',
      'chargeOffSession',
      TIMEOUT_MS
    );

    expectApiError(error, ErrorKeys.BILLING.PROVIDER_TIMEOUT);
    expect(error.getStatus()).toBe(504);
    expect(error.getResponse()).toEqual({
      message: `yookassa.chargeOffSession did not respond within ${TIMEOUT_MS}ms`,
      errorKey: ErrorKeys.BILLING.PROVIDER_TIMEOUT
    });
    expect(error.message).toBe(
      `yookassa.chargeOffSession did not respond within ${TIMEOUT_MS}ms`
    );
  });

  it('passes a call that settles in time through untouched', async () => {
    const inner = providerStub();
    const session = { url: 'https://pay.example/1', sessionRef: 'pay-1' };
    inner.startCheckout.mockResolvedValue(session);
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    await expect(
      provider.startCheckout(customer, plan, urls, true)
    ).resolves.toBe(session);
    expect(inner.startCheckout).toHaveBeenCalledWith(
      customer,
      plan,
      urls,
      true
    );
  });

  it('forwards every argument, including optional ones', async () => {
    const inner = providerStub();
    inner.chargeOffSession.mockResolvedValue({
      providerInvoiceRef: 'pay-1',
      status: 'captured'
    });
    const provider = withProviderDeadline(inner, TIMEOUT_MS);
    const items = [{ description: 'Pro', amountMinor: 1000, quantity: 1 }];

    await provider.chargeOffSession(customer, 1000, 'RUB', items, 'renewal:1');

    expect(inner.chargeOffSession).toHaveBeenCalledWith(
      customer,
      1000,
      'RUB',
      items,
      'renewal:1'
    );
  });

  it('bounds the single-payment charge lookup too', async () => {
    const inner = providerStub();
    inner.getOffSessionCharge.mockImplementation(hangs);
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    await expect(
      provider.getOffSessionCharge('pay-1', 'renewal:1')
    ).rejects.toThrow(
      new ProviderTimeoutError('yookassa', 'getOffSessionCharge', TIMEOUT_MS)
    );
    expect(inner.getOffSessionCharge).toHaveBeenCalledWith(
      'pay-1',
      'renewal:1'
    );
  });

  it('answers a provider failure as a bad gateway that keeps the cause', async () => {
    const inner = providerStub();
    const failure = new Error('socket hang up');
    inner.chargeOffSession.mockRejectedValue(failure);
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    const error: unknown = await provider
      .chargeOffSession(customer, 1000, 'RUB', [])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expectApiError(error, ErrorKeys.BILLING.PROVIDER_ERROR);
    expect((error as ProviderError).getStatus()).toBe(502);
    expect((error as ProviderError).cause).toBe(failure);
  });

  it('passes an HTTP answer of ours through, so a decline stays a decline', async () => {
    const inner = providerStub();
    const declined = new ChargeDeclinedError();
    inner.chargeOffSession.mockRejectedValue(declined);
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    await expect(
      provider.chargeOffSession(customer, 1000, 'RUB', [])
    ).rejects.toBe(declined);
  });

  it('answers a synchronous throw as a bad gateway too', async () => {
    const inner = providerStub();
    inner.cancel.mockImplementation(() => {
      throw new Error('not configured');
    });
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    const error: unknown = await provider
      .cancel('sub-1', 'immediate')
      .catch((caught: unknown) => caught);

    expectApiError(error, ErrorKeys.BILLING.PROVIDER_ERROR);
  });

  it('clears the deadline timer once the call settles', async () => {
    jest.useFakeTimers();
    try {
      const inner = providerStub();
      inner.cancel.mockResolvedValue(undefined);
      const provider = withProviderDeadline(inner, TIMEOUT_MS);

      await provider.cancel('sub-1', 'period_end');

      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('exposes the wrapped provider identity', () => {
    const inner = providerStub();
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    expect(provider.id).toBe('yookassa');
    expect(provider.managesLifecycle).toBe(false);
  });

  it.each([0, -1, Number.NaN])(
    'keeps the error mapping but sets no timer for the disabled deadline %p',
    async (timeoutMs) => {
      jest.useFakeTimers();
      try {
        const inner = providerStub();
        inner.cancel.mockRejectedValue(new Error('socket hang up'));
        const provider = withProviderDeadline(inner, timeoutMs);
        expect(provider).toBeInstanceOf(DeadlineBoundProvider);

        const pending = provider
          .cancel('sub-1', 'immediate')
          .catch((caught: unknown) => caught);
        expect(jest.getTimerCount()).toBe(0);
        expectApiError(await pending, ErrorKeys.BILLING.PROVIDER_ERROR);
      } finally {
        jest.useRealTimers();
      }
    }
  );
});
