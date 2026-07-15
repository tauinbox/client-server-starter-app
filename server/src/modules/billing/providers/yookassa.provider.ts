import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  NotImplementedException,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import type {
  ICreatePayment,
  ICreateRefund,
  IItem,
  IReceipt,
  YooCheckout
} from '@a2seven/yoo-checkout';
import { User } from '../../users/entities/user.entity';
import type { Customer } from '../entities/customer.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import type { Plan } from '../entities/plan.entity';
import { YOOKASSA_CLIENT } from './yookassa.client';
import type {
  CancelMode,
  ChargeResult,
  CheckoutSession,
  CheckoutUrls,
  NormalizedCustomerRef,
  NormalizedEvent,
  NormalizedInvoicePayload,
  NormalizedPaymentFailedPayload,
  NormalizedPaymentMethodPayload,
  OneTimePaymentParams,
  OneTimePaymentSession,
  PaymentProvider,
  ReceiptItem
} from './payment-provider.interface';

/**
 * Metadata marker a payment-method-update re-bind payment carries, so its
 * success webhook maps to `payment_method.updated` (a default-method swap)
 * instead of `invoice.paid` (which would insert an invoice and re-activate).
 */
const METHOD_UPDATE_PURPOSE = 'method_update';

/**
 * Metadata marker a standalone one-time purchase carries, so its
 * success webhook reduces onto a `kind 'one_time'` invoice instead of being
 * mistaken for a subscription first payment (which would activate the
 * customer's open subscription and save the card).
 */
const ONE_TIME_PURPOSE = 'one_time';

/**
 * Marks a core-initiated off-session charge (renewal, trial conversion, usage
 * close, plan-change proration), carrying the `chargeKey` of the invoice the
 * core already recorded. Routes the confirming webhook to a reconcile/no-op so
 * it neither double-records nor re-activates — the scheduler owns the lifecycle.
 */
const OFF_SESSION_PURPOSE = 'off_session';

/** Minor units (kopecks) → YooKassa decimal string, e.g. `99000` → `'990.00'`. */
function toAmountValue(amountMinor: number): string {
  return Money.fromMinor(amountMinor).toMajorString(2);
}

/** YooKassa decimal string → minor units, e.g. `'990.00'` → `99000`. */
function toMinor(value: string): number {
  return Money.fromMajorString(value, 2).toNumber();
}

/** Whether a payment is a method-update re-bind (per its metadata marker). */
function isMethodUpdate(metadata: unknown): boolean {
  const data = (metadata ?? {}) as Record<string, unknown>;
  return data['purpose'] === METHOD_UPDATE_PURPOSE;
}

/** Reads the one-time purchase marker + product id echoed via metadata. */
function oneTimeFromMetadata(
  metadata: unknown
): { productId: string | null } | null {
  const data = (metadata ?? {}) as Record<string, unknown>;
  if (data['purpose'] !== ONE_TIME_PURPOSE) {
    return null;
  }
  const productId = data['productId'];
  return { productId: typeof productId === 'string' ? productId : null };
}

/**
 * Reads the off-session charge marker — returns the core invoice key the
 * confirming webhook must reconcile onto, or `null` if the payment is not a
 * core-initiated off-session charge.
 */
function offSessionChargeKeyFrom(metadata: unknown): string | null {
  const data = (metadata ?? {}) as Record<string, unknown>;
  if (data['purpose'] !== OFF_SESSION_PURPOSE) {
    return null;
  }
  const key = data['chargeKey'];
  return typeof key === 'string' ? key : null;
}

/** Reads our `customerId`/`userId` echoed back through YooKassa metadata. */
function refFromMetadata(metadata: unknown): NormalizedCustomerRef {
  const data = (metadata ?? {}) as Record<string, unknown>;
  const customerId = data['customerId'];
  const userId = data['userId'];
  return {
    customerId: typeof customerId === 'string' ? customerId : undefined,
    userId: typeof userId === 'string' ? userId : undefined
  };
}

/** Shape of a YooKassa webhook notification body (`object` is a payment/refund). */
interface YooKassaNotification {
  event?: string;
  object?: { id?: string; metadata?: unknown };
}

/**
 * YooKassa (Russia, 54-FZ). Self-managed lifecycle (`managesLifecycle = false`):
 * there is no provider-side subscription object — the core drives renewals and
 * dunning (the BullMQ scheduler) and `chargeOffSession` autopays the saved card.
 * Checkout creates a payment with a redirect confirmation and `save_payment_method`
 * (or a zero-amount card binding for trials); charges/refunds carry a 54-FZ
 * `receipt` and a caller-supplied `Idempotence-Key`. Webhooks are unsigned —
 * `verifyAndParseWebhook` re-fetches the object by id (authoritative) rather than
 * trusting the notification body.
 */
@Injectable()
export class YooKassaProvider implements PaymentProvider {
  readonly id = 'yookassa' as const;
  readonly managesLifecycle = false;

  private readonly logger = new Logger(YooKassaProvider.name);
  private readonly vatCode: number;

  constructor(
    @Inject(YOOKASSA_CLIENT) private readonly yoo: YooCheckout | null,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PaymentMethod)
    private readonly paymentMethods: Repository<PaymentMethod>,
    config: ConfigService
  ) {
    // 54-FZ requires a VAT code on every receipt line; the correct value is
    // deployment-specific (tax regime), so it is configurable. `1` = "без НДС".
    this.vatCode = Number(config.get<string>('YOOKASSA_VAT_CODE') ?? '1');
  }

  private requireClient(): YooCheckout {
    if (!this.yoo) {
      throw new ServiceUnavailableException('YooKassa is not configured');
    }
    return this.yoo;
  }

  ensureCustomer(customer: Customer): Promise<string> {
    // YooKassa has no customer object to create — payments carry our identifiers
    // via `metadata`/`merchant_customer_id`. The billing customer id is the
    // stable reference we tag every payment with.
    return Promise.resolve(customer.providerCustomerId ?? customer.id);
  }

  chargeUsage(): Promise<void> {
    // Self-managed lifecycle: usage periods are closed and charged by the
    // renewal scheduler through chargeOffSession (with the 54-FZ receipt).
    throw new NotImplementedException(
      'YooKassaProvider.chargeUsage is not applicable (usage is charged by the renewal scheduler)'
    );
  }

  changePlan(): Promise<void> {
    // Self-managed lifecycle: there is no provider-side subscription to update.
    // The core computes the proration (ProrationCalculator) and settles it via
    // refund + chargeOffSession with the two 54-FZ documents.
    throw new NotImplementedException(
      'YooKassaProvider.changePlan is not applicable (proration is computed by the core)'
    );
  }

  previewChangePlan(): Promise<never> {
    throw new NotImplementedException(
      'YooKassaProvider.previewChangePlan is not applicable (proration is computed by the core)'
    );
  }

  async startCheckout(
    customer: Customer,
    plan: Plan,
    urls: CheckoutUrls
  ): Promise<CheckoutSession> {
    const yoo = this.requireClient();
    const price = plan.prices.yookassa;
    if (!price) {
      throw new ServiceUnavailableException(
        `Plan "${plan.key}" has no YooKassa price configured`
      );
    }

    const metadata = {
      customerId: customer.id,
      userId: customer.userId,
      planKey: plan.key
    };
    const isTrial = plan.trialDays > 0;

    // Trial = zero-amount card binding (save the method now, charge at trial end
    // via the scheduler); no money moves, so no fiscal receipt. A paid first
    // period creates a real payment with a 54-FZ receipt.
    const payload: ICreatePayment = {
      amount: {
        value: toAmountValue(isTrial ? 0 : price.amountMinor),
        currency: price.currency
      },
      capture: true,
      save_payment_method: true,
      confirmation: { type: 'redirect', return_url: urls.successUrl },
      description: plan.name,
      metadata,
      merchant_customer_id: customer.id,
      ...(isTrial
        ? {}
        : {
            receipt: await this.buildReceipt(
              customer.userId,
              [
                {
                  description: plan.name,
                  amountMinor: price.amountMinor,
                  quantity: 1
                }
              ],
              price.currency
            )
          })
    };

    const payment = await yoo.createPayment(payload, randomUUID());
    const url = payment.confirmation?.confirmation_url;
    if (!url) {
      throw new ServiceUnavailableException(
        'YooKassa did not return a confirmation URL'
      );
    }
    return { url, sessionRef: payment.id };
  }

  /**
   * Standalone one-time purchase: a plain payment with a 54-FZ
   * receipt and a redirect confirmation — the card is NOT saved (no
   * `save_payment_method`). The one-time marker + `productId` ride in metadata
   * so the success webhook reduces onto a `one_time` invoice instead of
   * activating a subscription.
   */
  async createOneTimePayment(
    customer: Customer,
    params: OneTimePaymentParams
  ): Promise<OneTimePaymentSession> {
    const yoo = this.requireClient();
    const payload: ICreatePayment = {
      amount: {
        value: toAmountValue(params.amountMinor),
        currency: params.currency
      },
      capture: true,
      confirmation: { type: 'redirect', return_url: params.urls.successUrl },
      description: params.description,
      metadata: {
        customerId: customer.id,
        userId: customer.userId,
        purpose: ONE_TIME_PURPOSE,
        productId: params.productId
      },
      merchant_customer_id: customer.id,
      receipt: await this.buildReceipt(
        customer.userId,
        params.receiptItems,
        params.currency
      )
    };

    const payment = await yoo.createPayment(payload, randomUUID());
    const url = payment.confirmation?.confirmation_url;
    if (!url) {
      throw new ServiceUnavailableException(
        'YooKassa did not return a confirmation URL'
      );
    }
    return { url, sessionRef: payment.id };
  }

  /**
   * Replaces the saved card via a zero-amount re-bind (the same
   * save-without-payment mechanism trials use): no money moves, so no fiscal
   * receipt. The `purpose` metadata routes the success webhook to
   * `payment_method.updated`, where the reducer swaps the default method.
   */
  async updatePaymentMethod(
    _providerSubscriptionId: string | null,
    customer: Customer,
    urls: CheckoutUrls
  ): Promise<CheckoutSession> {
    const yoo = this.requireClient();
    const payload: ICreatePayment = {
      amount: { value: toAmountValue(0), currency: customer.currency },
      capture: true,
      save_payment_method: true,
      confirmation: { type: 'redirect', return_url: urls.successUrl },
      description: 'Payment method update',
      metadata: {
        customerId: customer.id,
        userId: customer.userId,
        purpose: METHOD_UPDATE_PURPOSE
      },
      merchant_customer_id: customer.id
    };

    const payment = await yoo.createPayment(payload, randomUUID());
    const url = payment.confirmation?.confirmation_url;
    if (!url) {
      throw new ServiceUnavailableException(
        'YooKassa did not return a confirmation URL'
      );
    }
    return { url, sessionRef: payment.id };
  }

  async chargeOffSession(
    customer: Customer,
    amountMinor: number,
    receiptItems: ReceiptItem[],
    idempotencyKey?: string
  ): Promise<ChargeResult> {
    const yoo = this.requireClient();
    const token = await this.resolveSavedMethodRef(customer);

    const payload: ICreatePayment = {
      amount: {
        value: toAmountValue(amountMinor),
        currency: customer.currency
      },
      capture: true,
      payment_method_id: token,
      description: receiptItems[0]?.description ?? 'Subscription charge',
      // The idempotency key is the core invoice's providerEventId; echo it so
      // the confirming webhook reconciles onto that invoice (see OFF_SESSION_PURPOSE).
      metadata: {
        customerId: customer.id,
        userId: customer.userId,
        ...(idempotencyKey
          ? { purpose: OFF_SESSION_PURPOSE, chargeKey: idempotencyKey }
          : {})
      },
      merchant_customer_id: customer.id,
      receipt: await this.buildReceipt(
        customer.userId,
        receiptItems,
        customer.currency
      )
    };

    const payment = await yoo.createPayment(
      payload,
      idempotencyKey ?? randomUUID()
    );

    // `canceled` is a hard decline; anything short of `succeeded` (the
    // payment-after-receipt fiscalization window) may still cancel at capture,
    // so it is reported as `pending`, never as captured funds.
    if (payment.status === 'canceled') {
      throw new ServiceUnavailableException(
        `YooKassa charge for customer "${customer.id}" was declined`
      );
    }
    return {
      providerInvoiceRef: payment.id,
      status: payment.status === 'succeeded' ? 'captured' : 'pending'
    };
  }

  /**
   * YooKassa cannot look a payment up by its `Idempotence-Key` (the key store
   * lives ~24h, far shorter than the 3-day dunning spacing), so the prior
   * attempt is found by scanning the payment list for the `chargeKey` echoed
   * through `metadata` by `chargeOffSession`. `canceled` payments are skipped —
   * a hard decline legitimately re-charges. The scan is bounded: if the key is
   * not settled within the page cap, the lookup fails loudly (the renewal
   * scheduler skips the cycle and retries) rather than green-lighting a charge
   * that may duplicate a captured payment.
   */
  async findOffSessionCharge(
    chargeKey: string,
    createdAfter: Date
  ): Promise<ChargeResult | null> {
    const yoo = this.requireClient();
    const maxPages = 20;
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const list = await yoo.getPaymentList({
        created_at: { value: createdAfter.toISOString(), mode: 'gte' },
        limit: 100,
        ...(cursor ? { cursor } : {})
      });
      const match = (list.items ?? []).find(
        (payment) =>
          offSessionChargeKeyFrom(payment.metadata) === chargeKey &&
          payment.status !== 'canceled'
      );
      if (match) {
        return {
          providerInvoiceRef: match.id,
          status: match.status === 'succeeded' ? 'captured' : 'pending'
        };
      }
      if (!list.next_cursor) {
        return null;
      }
      cursor = list.next_cursor;
    }
    throw new ServiceUnavailableException(
      `YooKassa payment scan for charge key "${chargeKey}" exceeded ${maxPages} pages without a definitive answer`
    );
  }

  cancel(_providerSubscriptionId: string, _mode: CancelMode): Promise<void> {
    // Self-managed: there is no provider-side subscription to cancel. The core
    // stops the renewal loop and downgrades entitlements; the saved card is
    // simply no longer charged.
    return Promise.resolve();
  }

  async refund(
    providerInvoiceRef: string,
    amountMinor: number,
    idempotencyKey?: string
  ): Promise<void> {
    const yoo = this.requireClient();

    // Re-fetch the original payment for the buyer (receipt email) and the
    // currency/description to fiscalize the refund.
    const payment = await yoo.getPayment(providerInvoiceRef);
    const currency = payment.amount?.currency ?? 'RUB';
    const refundMinor =
      amountMinor > 0 ? amountMinor : toMinor(payment.amount.value);
    const userId = refFromMetadata(payment.metadata).userId;

    const payload: ICreateRefund = {
      payment_id: providerInvoiceRef,
      amount: { value: toAmountValue(refundMinor), currency },
      receipt: await this.buildReceipt(
        userId,
        [
          {
            description: payment.description || 'Subscription refund',
            amountMinor: refundMinor,
            quantity: 1
          }
        ],
        currency
      )
    };

    await yoo.createRefund(payload, idempotencyKey ?? randomUUID());
  }

  async verifyAndParseWebhook(
    rawBody: Buffer
  ): Promise<NormalizedEvent | null> {
    if (!this.yoo) {
      return null;
    }

    let notification: YooKassaNotification;
    try {
      notification = JSON.parse(
        rawBody.toString('utf8')
      ) as YooKassaNotification;
    } catch {
      return null;
    }

    const event = notification.event;
    const objectId = notification.object?.id;
    if (!event || !objectId) {
      return null;
    }

    // Re-fetch the payment by id — the notification body is not trusted (no
    // signature), the API object is authoritative. Refund/other events carry no
    // state we reduce here, so they are ignored.
    if (event !== 'payment.succeeded' && event !== 'payment.canceled') {
      return null;
    }

    let payment;
    try {
      payment = await this.yoo.getPayment(objectId);
    } catch (error) {
      this.logger.warn(
        `YooKassa webhook re-fetch failed for ${objectId}: ${(error as Error).message}`
      );
      return null;
    }

    const base = {
      provider: this.id,
      providerEventId: `${event}:${objectId}`
    };
    const ref = refFromMetadata(payment.metadata);

    if (payment.status === 'succeeded') {
      const method = payment.payment_method;
      const savedPaymentMethod =
        method?.saved && method.id
          ? {
              providerMethodRef: method.id,
              brand: method.card?.card_type ?? 'card',
              last4: method.card?.last4 ?? '0000'
            }
          : null;
      // A method-update re-bind is not a payment: swap the default method,
      // never insert an invoice or touch the subscription status.
      if (isMethodUpdate(payment.metadata)) {
        const payload: NormalizedPaymentMethodPayload = {
          ref,
          savedPaymentMethod
        };
        return { ...base, type: 'payment_method.updated', payload };
      }
      // Surface the off-session charge key so the reducer reconciles onto the
      // invoice the core already recorded (see OFF_SESSION_PURPOSE).
      const offSessionChargeKey = offSessionChargeKeyFrom(payment.metadata);
      if (offSessionChargeKey) {
        const payload: NormalizedInvoicePayload = {
          ref,
          providerInvoiceRef: payment.id,
          providerSubscriptionId: null,
          amountMinor: toMinor(payment.amount.value),
          currency: payment.amount.currency,
          periodStart: null,
          periodEnd: null,
          paidAt: payment.captured_at ?? payment.created_at ?? null,
          savedPaymentMethod: null,
          offSessionChargeKey
        };
        return { ...base, type: 'invoice.paid', payload };
      }
      // A one-time purchase never saves a card or touches the subscription —
      // the marker routes the reducer to the one_time invoice + grant path.
      const oneTime = oneTimeFromMetadata(payment.metadata);
      const payload: NormalizedInvoicePayload = {
        ref,
        providerInvoiceRef: payment.id,
        providerSubscriptionId: null,
        amountMinor: toMinor(payment.amount.value),
        currency: payment.amount.currency,
        periodStart: null,
        periodEnd: null,
        paidAt: payment.captured_at ?? payment.created_at ?? null,
        savedPaymentMethod: oneTime ? null : savedPaymentMethod,
        ...(oneTime ? { kind: 'one_time', productId: oneTime.productId } : {})
      };
      return { ...base, type: 'invoice.paid', payload };
    }

    if (payment.status === 'canceled') {
      // A method-update/one-time has nothing pending locally to fail.
      if (
        isMethodUpdate(payment.metadata) ||
        oneTimeFromMetadata(payment.metadata)
      ) {
        return null;
      }
      // An off-session charge canceled at capture (accepted as `pending`, then
      // declined) must fail the pending invoice the core recorded. For a
      // synchronous decline (chargeOffSession threw, nothing recorded) the
      // reducer's status-gated flip makes this a no-op.
      const payload: NormalizedPaymentFailedPayload = {
        ref,
        providerSubscriptionId: null,
        offSessionChargeKey: offSessionChargeKeyFrom(payment.metadata)
      };
      return { ...base, type: 'payment.failed', payload };
    }

    // `pending`/`waiting_for_capture` are not terminal — wait for the next event.
    return null;
  }

  /**
   * Builds a 54-FZ `receipt` (items + buyer contact). The buyer email is
   * required for fiscalization and is resolved from the customer's user record
   * (the interface, fixed in the design, carries only line items).
   */
  private async buildReceipt(
    userId: string | undefined,
    receiptItems: ReceiptItem[],
    currency: string
  ): Promise<IReceipt> {
    const email = userId ? await this.resolveEmail(userId) : undefined;
    const items: IItem[] = receiptItems.map((item) => ({
      description: item.description,
      quantity: String(item.quantity),
      amount: {
        value: toAmountValue(item.amountMinor),
        currency
      },
      vat_code: this.vatCode
    }));
    return {
      ...(email ? { customer: { email }, email } : {}),
      items
    };
  }

  /**
   * Resolves the raw YooKassa saved-card token (`providerMethodRef`) for the
   * customer's default payment method — the off-session autopay reference. The
   * locked interface passes only the `Customer`, so the token is loaded from its
   * default `PaymentMethod`.
   */
  private async resolveSavedMethodRef(customer: Customer): Promise<string> {
    const methodId = customer.defaultPaymentMethodId;
    if (!methodId) {
      throw new ServiceUnavailableException(
        `Customer "${customer.id}" has no saved YooKassa payment method`
      );
    }
    const method = await this.paymentMethods.findOne({
      where: { id: methodId }
    });
    if (!method) {
      throw new ServiceUnavailableException(
        `Saved payment method "${methodId}" was not found`
      );
    }
    return method.providerMethodRef;
  }

  private async resolveEmail(userId: string): Promise<string | undefined> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { email: true }
    });
    return user?.email;
  }
}
