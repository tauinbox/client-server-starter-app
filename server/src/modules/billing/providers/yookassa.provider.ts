import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  PaymentProvider,
  ReceiptItem
} from './payment-provider.interface';

/** Minor units (kopecks) → YooKassa decimal string, e.g. `99000` → `'990.00'`. */
function toAmountValue(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

/** YooKassa decimal string → minor units, e.g. `'990.00'` → `99000`. */
function toMinor(value: string): number {
  return Math.round(Number.parseFloat(value) * 100);
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
      metadata: { customerId: customer.id, userId: customer.userId },
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

    // `canceled` is a hard decline. `pending`/`waiting_for_capture` mean the
    // charge was accepted but fiscalization (payment-after-receipt) has not
    // settled yet — it resolves to `succeeded` via a later webhook, so both
    // count as success here.
    if (payment.status === 'canceled') {
      throw new ServiceUnavailableException(
        `YooKassa charge for customer "${customer.id}" was declined`
      );
    }
    return { providerInvoiceRef: payment.id };
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
      const payload: NormalizedInvoicePayload = {
        ref,
        providerInvoiceRef: payment.id,
        providerSubscriptionId: null,
        amountMinor: toMinor(payment.amount.value),
        currency: payment.amount.currency,
        periodStart: null,
        periodEnd: null,
        paidAt: payment.captured_at ?? payment.created_at ?? null
      };
      return { ...base, type: 'invoice.paid', payload };
    }

    if (payment.status === 'canceled') {
      const payload: NormalizedPaymentFailedPayload = {
        ref,
        providerSubscriptionId: null
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
