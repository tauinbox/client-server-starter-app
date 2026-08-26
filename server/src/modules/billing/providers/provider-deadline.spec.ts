import type { Customer } from '../entities/customer.entity';
import type { PaymentProvider } from './payment-provider.interface';
import {
  DeadlineBoundProvider,
  ProviderTimeoutError,
  withProviderDeadline
} from './provider-deadline';

const TIMEOUT_MS = 20;

function providerStub() {
  return {
    id: 'yookassa',
    managesLifecycle: false,
    ensureCustomer: jest.fn(),
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

/** A call that never settles — the stalled socket this wrapper exists for. */
const hangs = (): Promise<never> => new Promise<never>(() => {});

describe('withProviderDeadline', () => {
  it('rejects a call that outlives the deadline, naming provider and method', async () => {
    const inner = providerStub();
    inner.ensureCustomer.mockImplementation(hangs);
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    await expect(provider.ensureCustomer(customer)).rejects.toThrow(
      new ProviderTimeoutError('yookassa', 'ensureCustomer', TIMEOUT_MS)
    );
  });

  it('passes a call that settles in time through untouched', async () => {
    const inner = providerStub();
    inner.ensureCustomer.mockResolvedValue('provider-cust-1');
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    await expect(provider.ensureCustomer(customer)).resolves.toBe(
      'provider-cust-1'
    );
    expect(inner.ensureCustomer).toHaveBeenCalledWith(customer);
  });

  it('forwards every argument, including optional ones', async () => {
    const inner = providerStub();
    inner.chargeOffSession.mockResolvedValue({
      providerInvoiceRef: 'pay-1',
      status: 'captured'
    });
    const provider = withProviderDeadline(inner, TIMEOUT_MS);
    const items = [{ description: 'Pro', amountMinor: 1000, quantity: 1 }];

    await provider.chargeOffSession(customer, 1000, items, 'renewal:1');

    expect(inner.chargeOffSession).toHaveBeenCalledWith(
      customer,
      1000,
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

  it('propagates the underlying failure instead of masking it as a timeout', async () => {
    const inner = providerStub();
    const failure = new Error('card declined');
    inner.chargeOffSession.mockRejectedValue(failure);
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    await expect(provider.chargeOffSession(customer, 1000, [])).rejects.toBe(
      failure
    );
  });

  it('propagates a synchronous throw as a rejection', async () => {
    const inner = providerStub();
    inner.cancel.mockImplementation(() => {
      throw new Error('not configured');
    });
    const provider = withProviderDeadline(inner, TIMEOUT_MS);

    await expect(provider.cancel('sub-1', 'immediate')).rejects.toThrow(
      'not configured'
    );
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

  it('returns the provider untouched when the deadline is disabled', () => {
    const inner = providerStub();

    expect(withProviderDeadline(inner, 0)).toBe(inner);
    expect(withProviderDeadline(inner, -1)).toBe(inner);
    expect(withProviderDeadline(inner, Number.NaN)).toBe(inner);
    expect(withProviderDeadline(inner, TIMEOUT_MS)).toBeInstanceOf(
      DeadlineBoundProvider
    );
  });
});
