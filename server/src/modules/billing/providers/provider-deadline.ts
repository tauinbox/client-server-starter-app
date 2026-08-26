import type { BillingProviderId } from '@app/shared/types';
import type { Customer } from '../entities/customer.entity';
import type { Plan } from '../entities/plan.entity';
import type {
  CancelMode,
  ChangePreview,
  ChargeResult,
  CheckoutSession,
  CheckoutUrls,
  OneTimePaymentParams,
  OneTimePaymentSession,
  PaymentProvider,
  ReceiptItem,
  WebhookVerificationResult
} from './payment-provider.interface';

/**
 * Deadline applied to a single provider API call when
 * `BILLING_PROVIDER_TIMEOUT_MS` is unset. Generous next to normal provider
 * latency (sub-second to a few seconds) and far below the hourly renewal scan,
 * so it only trips on a call that is genuinely stuck.
 */
export const DEFAULT_BILLING_PROVIDER_TIMEOUT_MS = 20_000;

/** Raised when a provider call outlives its deadline. */
export class ProviderTimeoutError extends Error {
  constructor(
    readonly provider: BillingProviderId,
    readonly method: string,
    readonly timeoutMs: number
  ) {
    super(`${provider}.${method} did not respond within ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
  }
}

/**
 * Bounds every `PaymentProvider` call at our boundary rather than trusting the
 * SDKs: the YooKassa SDK issues bare `axios` requests with no `timeout` (axios
 * has no default), and the Paddle SDK calls global `fetch` with no signal, so a
 * stalled socket otherwise hangs for as long as the peer keeps it open. The
 * renewal scan processes due subscriptions sequentially, so one such call
 * blocks every other customer's renewal; a stuck webhook re-fetch holds the
 * provider's inbound request open until it times out and redelivers.
 *
 * The deadline bounds *our* call, not the provider's request — rejecting the
 * wrapper does not cancel the underlying socket. That is the property needed
 * here: the caller's existing failure paths take over (a poll error skips the
 * cycle, a charge error walks dunning, and a dunning retry reconciles against
 * `findOffSessionCharge` so an ambiguous timeout never charges twice).
 *
 * Implemented as an explicit delegate rather than a proxy so that a method
 * added to `PaymentProvider` fails to compile until it is bounded too.
 */
export class DeadlineBoundProvider implements PaymentProvider {
  constructor(
    private readonly inner: PaymentProvider,
    private readonly timeoutMs: number
  ) {}

  get id(): BillingProviderId {
    return this.inner.id;
  }

  get managesLifecycle(): boolean {
    return this.inner.managesLifecycle;
  }

  ensureCustomer(customer: Customer): Promise<string> {
    return this.bound('ensureCustomer', () =>
      this.inner.ensureCustomer(customer)
    );
  }

  startCheckout(
    customer: Customer,
    plan: Plan,
    urls: CheckoutUrls
  ): Promise<CheckoutSession> {
    return this.bound('startCheckout', () =>
      this.inner.startCheckout(customer, plan, urls)
    );
  }

  chargeOffSession(
    customer: Customer,
    amountMinor: number,
    receiptItems: ReceiptItem[],
    idempotencyKey?: string
  ): Promise<ChargeResult> {
    return this.bound('chargeOffSession', () =>
      this.inner.chargeOffSession(
        customer,
        amountMinor,
        receiptItems,
        idempotencyKey
      )
    );
  }

  findOffSessionCharge(
    chargeKey: string,
    createdAfter: Date
  ): Promise<ChargeResult | null> {
    return this.bound('findOffSessionCharge', () =>
      this.inner.findOffSessionCharge(chargeKey, createdAfter)
    );
  }

  getOffSessionCharge(
    providerInvoiceRef: string,
    chargeKey: string
  ): Promise<ChargeResult | null> {
    return this.bound('getOffSessionCharge', () =>
      this.inner.getOffSessionCharge(providerInvoiceRef, chargeKey)
    );
  }

  createOneTimePayment(
    customer: Customer,
    params: OneTimePaymentParams
  ): Promise<OneTimePaymentSession> {
    return this.bound('createOneTimePayment', () =>
      this.inner.createOneTimePayment(customer, params)
    );
  }

  chargeUsage(
    providerSubscriptionId: string,
    amountMinor: number,
    currency: string,
    description: string,
    chargeKey: string
  ): Promise<void> {
    return this.bound('chargeUsage', () =>
      this.inner.chargeUsage(
        providerSubscriptionId,
        amountMinor,
        currency,
        description,
        chargeKey
      )
    );
  }

  changePlan(
    providerSubscriptionId: string,
    customer: Customer,
    plan: Plan
  ): Promise<void> {
    return this.bound('changePlan', () =>
      this.inner.changePlan(providerSubscriptionId, customer, plan)
    );
  }

  previewChangePlan(
    providerSubscriptionId: string,
    plan: Plan
  ): Promise<ChangePreview> {
    return this.bound('previewChangePlan', () =>
      this.inner.previewChangePlan(providerSubscriptionId, plan)
    );
  }

  updatePaymentMethod(
    providerSubscriptionId: string | null,
    customer: Customer,
    urls: CheckoutUrls
  ): Promise<CheckoutSession> {
    return this.bound('updatePaymentMethod', () =>
      this.inner.updatePaymentMethod(providerSubscriptionId, customer, urls)
    );
  }

  cancel(providerSubscriptionId: string, mode: CancelMode): Promise<void> {
    return this.bound('cancel', () =>
      this.inner.cancel(providerSubscriptionId, mode)
    );
  }

  refund(
    providerInvoiceRef: string,
    amountMinor: number,
    idempotencyKey?: string
  ): Promise<void> {
    return this.bound('refund', () =>
      this.inner.refund(providerInvoiceRef, amountMinor, idempotencyKey)
    );
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<WebhookVerificationResult> {
    return this.bound('verifyAndParseWebhook', () =>
      this.inner.verifyAndParseWebhook(rawBody, headers)
    );
  }

  private async bound<T>(method: string, call: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        call(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ProviderTimeoutError(this.inner.id, method, this.timeoutMs)
              ),
            this.timeoutMs
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Wraps `provider` so each call rejects with `ProviderTimeoutError` after
 * `timeoutMs`. A non-positive or non-finite deadline disables the bound and
 * returns the provider untouched.
 */
export function withProviderDeadline(
  provider: PaymentProvider,
  timeoutMs: number
): PaymentProvider {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return provider;
  }
  return new DeadlineBoundProvider(provider, timeoutMs);
}
