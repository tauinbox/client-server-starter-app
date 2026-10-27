import { HttpException } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import { ApiError } from '../../../common/errors/api-error';
import type { BillingProviderId, CancelMode } from '@app/shared/types';
import type { Customer } from '../entities/customer.entity';
import type { Plan } from '../entities/plan.entity';
import type {
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

/**
 * Largest deadline `BILLING_PROVIDER_TIMEOUT_MS` accepts. The lease of a plan
 * change is sized from it (`PLAN_CHANGE_LEASE_MS`), so a larger deadline would
 * let a live change outlast its lease and race the renewal scan.
 */
export const MAX_BILLING_PROVIDER_TIMEOUT_MS = 120_000;

/**
 * Raised when a provider call outlives its deadline. The deadline does not
 * cancel the provider's request, so money may have moved.
 */
export class ProviderTimeoutError extends ApiError {
  constructor(
    readonly provider: BillingProviderId,
    readonly method: string,
    readonly timeoutMs: number
  ) {
    super(
      ErrorKeys.BILLING.PROVIDER_TIMEOUT,
      `${provider}.${method} did not respond within ${timeoutMs}ms`
    );
    this.name = 'ProviderTimeoutError';
  }
}

/**
 * Raised when a provider call fails with an error that is not an HTTP answer
 * of ours: a dropped socket, or an error answer of the provider API.
 */
export class ProviderError extends ApiError {
  constructor(
    readonly provider: BillingProviderId,
    readonly method: string,
    cause: unknown
  ) {
    super(
      ErrorKeys.BILLING.PROVIDER_ERROR,
      `${provider}.${method} failed`,
      {},
      { cause }
    );
    this.name = 'ProviderError';
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
    private readonly timeoutMs: number | null
  ) {}

  get id(): BillingProviderId {
    return this.inner.id;
  }

  get managesLifecycle(): boolean {
    return this.inner.managesLifecycle;
  }

  startCheckout(
    customer: Customer,
    plan: Plan,
    urls: CheckoutUrls,
    trial: boolean
  ): Promise<CheckoutSession> {
    return this.bound('startCheckout', () =>
      this.inner.startCheckout(customer, plan, urls, trial)
    );
  }

  chargeOffSession(
    customer: Customer,
    amountMinor: number,
    currency: string,
    receiptItems: ReceiptItem[],
    idempotencyKey?: string
  ): Promise<ChargeResult> {
    return this.bound('chargeOffSession', () =>
      this.inner.chargeOffSession(
        customer,
        amountMinor,
        currency,
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
    currency: string,
    urls: CheckoutUrls
  ): Promise<CheckoutSession> {
    return this.bound('updatePaymentMethod', () =>
      this.inner.updatePaymentMethod(
        providerSubscriptionId,
        customer,
        currency,
        urls
      )
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
      const calls: Promise<T>[] = [call()];
      if (this.timeoutMs !== null) {
        const timeoutMs = this.timeoutMs;
        calls.push(
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new ProviderTimeoutError(this.inner.id, method, timeoutMs)
                ),
              timeoutMs
            );
          })
        );
      }
      return await Promise.race(calls);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ProviderError(this.inner.id, method, error);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Wraps `provider` so each call rejects with `ProviderTimeoutError` after
 * `timeoutMs`, and with `ProviderError` when the provider throws anything that
 * is not an HTTP exception. A non-positive or non-finite deadline disables the
 * deadline only.
 */
export function withProviderDeadline(
  provider: PaymentProvider,
  timeoutMs: number
): PaymentProvider {
  const deadline =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;
  return new DeadlineBoundProvider(provider, deadline);
}
