import {
  Inject,
  Injectable,
  Logger,
  NotImplementedException,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventName,
  Paddle,
  type CurrencyCode,
  type SubscriptionNotification,
  type TransactionNotification
} from '@paddle/paddle-node-sdk';
import type { SubscriptionStatus } from '@app/shared/types';
import type { Customer } from '../entities/customer.entity';
import type { Plan } from '../entities/plan.entity';
import { PADDLE_CLIENT } from './paddle.client';
import type {
  CancelMode,
  ChangePreview,
  ChargeResult,
  CheckoutSession,
  CheckoutUrls,
  NormalizedCustomerRef,
  NormalizedEvent,
  NormalizedInvoicePayload,
  NormalizedPaymentFailedPayload,
  NormalizedSubscriptionPayload,
  PaymentProvider
} from './payment-provider.interface';

/** First header value (Paddle sends a single `paddle-signature`). */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Maps a Paddle subscription status onto our `SubscriptionStatus`. */
function mapSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
    case 'paused':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

/**
 * Reads the postpaid usage-charge key our `chargeUsage` planted in the
 * non-catalog price's custom data, echoed back on the charge's transaction.
 */
function usageChargeKeyFrom(txn: TransactionNotification): string | null {
  for (const item of txn.items ?? []) {
    const key: unknown = item.price?.customData?.['usageChargeKey'];
    if (typeof key === 'string') {
      return key;
    }
  }
  return null;
}

/** Reads our `customerId`/`userId` echoed back through Paddle custom data. */
function refFromCustomData(
  customData: Record<string, unknown> | null | undefined
): NormalizedCustomerRef {
  const customerId = customData?.['customerId'];
  const userId = customData?.['userId'];
  return {
    customerId: typeof customerId === 'string' ? customerId : undefined,
    userId: typeof userId === 'string' ? userId : undefined
  };
}

/**
 * Paddle (Merchant-of-Record, rest-of-world). Provider-managed lifecycle:
 * checkout opens a hosted Paddle transaction; renewals/dunning/proration happen
 * at Paddle and arrive as webhooks, which `verifyAndParseWebhook` (HMAC via
 * `webhooks.unmarshal`) turns into a provider-agnostic `NormalizedEvent` for the
 * core reducer. Cancel/refund proxy the Paddle subscription/adjustment APIs.
 */
@Injectable()
export class PaddleProvider implements PaymentProvider {
  readonly id = 'paddle' as const;
  readonly managesLifecycle = true;

  private readonly logger = new Logger(PaddleProvider.name);
  private readonly webhookSecret: string | undefined;

  constructor(
    @Inject(PADDLE_CLIENT) private readonly paddle: Paddle | null,
    config: ConfigService
  ) {
    this.webhookSecret = config.get<string>('PADDLE_WEBHOOK_SECRET');
  }

  private requireClient(): Paddle {
    if (!this.paddle) {
      throw new ServiceUnavailableException('Paddle is not configured');
    }
    return this.paddle;
  }

  ensureCustomer(customer: Customer): Promise<string> {
    if (customer.providerCustomerId) {
      return Promise.resolve(customer.providerCustomerId);
    }
    // Paddle creates/links the customer during hosted checkout (it collects the
    // email there) and we correlate back via custom data, so a standalone
    // create — which needs an email the billing Customer doesn't carry — is not
    // part of the M1 flow.
    throw new NotImplementedException(
      'Paddle links the customer during checkout; ensureCustomer is unused in M1'
    );
  }

  async startCheckout(
    customer: Customer,
    plan: Plan,
    urls: CheckoutUrls
  ): Promise<CheckoutSession> {
    const paddle = this.requireClient();
    const priceId = plan.prices.paddle?.providerPriceId;
    if (!priceId) {
      throw new ServiceUnavailableException(
        `Plan "${plan.key}" has no Paddle price configured`
      );
    }

    const transaction = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      ...(customer.providerCustomerId
        ? { customerId: customer.providerCustomerId }
        : {}),
      customData: {
        customerId: customer.id,
        userId: customer.userId,
        planKey: plan.key
      },
      checkout: { url: urls.successUrl }
    });

    const url = transaction.checkout?.url;
    if (!url) {
      throw new ServiceUnavailableException(
        'Paddle did not return a checkout URL'
      );
    }
    return { url, sessionRef: transaction.id };
  }

  chargeOffSession(): Promise<ChargeResult> {
    // Paddle owns renewals; off-session charging is the self-managed (YooKassa)
    // path. Paddle usage is charged via chargeUsage (createOneTimeCharge).
    throw new NotImplementedException(
      'PaddleProvider.chargeOffSession is not applicable (provider-managed lifecycle)'
    );
  }

  /**
   * Posts the period's usage total as a one-time charge on the subscription
   * (design §17.3 — postpaid at the billing-cycle boundary, no Paddle
   * metering). The price is non-catalog with the charge key in its custom
   * data; the resulting `transaction.completed` webhook carries it back so the
   * reducer reconciles the pending usage invoice.
   */
  async chargeUsage(
    providerSubscriptionId: string,
    amountMinor: number,
    currency: string,
    description: string,
    chargeKey: string
  ): Promise<void> {
    const paddle = this.requireClient();
    await paddle.subscriptions.createOneTimeCharge(providerSubscriptionId, {
      effectiveFrom: 'immediately',
      items: [
        {
          quantity: 1,
          price: {
            description,
            unitPrice: {
              amount: String(amountMinor),
              currencyCode: currency as CurrencyCode
            },
            product: { name: 'Metered usage', taxCategory: 'standard' },
            customData: { usageChargeKey: chargeKey }
          }
        }
      ]
    });
  }

  /** The new plan's Paddle catalog price id — required for update/preview. */
  private requirePriceId(plan: Plan): string {
    const priceId = plan.prices.paddle?.providerPriceId;
    if (!priceId) {
      throw new ServiceUnavailableException(
        `Plan "${plan.key}" has no Paddle price configured`
      );
    }
    return priceId;
  }

  /**
   * Delegated plan change (design §16.A): swap the subscription item to the new
   * plan's catalog price with `prorated_immediately` — Paddle computes the
   * credit/charge, bills the difference and emits `subscription.updated` +
   * `transaction.completed` webhooks that reconcile our rows. Custom data is
   * re-planted wholesale (the update replaces it): the customer identifiers the
   * reducer correlates by, and the NEW plan key so the webhook does not revert
   * the local plan to the stale checkout-time key.
   */
  async changePlan(
    providerSubscriptionId: string,
    customer: Customer,
    plan: Plan
  ): Promise<void> {
    const paddle = this.requireClient();
    await paddle.subscriptions.update(providerSubscriptionId, {
      items: [{ priceId: this.requirePriceId(plan), quantity: 1 }],
      prorationBillingMode: 'prorated_immediately',
      customData: {
        customerId: customer.id,
        userId: customer.userId,
        planKey: plan.key
      }
    });
  }

  async previewChangePlan(
    providerSubscriptionId: string,
    plan: Plan
  ): Promise<ChangePreview> {
    const paddle = this.requireClient();
    const preview = await paddle.subscriptions.previewUpdate(
      providerSubscriptionId,
      {
        items: [{ priceId: this.requirePriceId(plan), quantity: 1 }],
        prorationBillingMode: 'prorated_immediately'
      }
    );
    return {
      amountMinor: Number(
        preview.immediateTransaction?.details?.totals?.total ?? '0'
      ),
      currency: preview.currencyCode ?? plan.prices.paddle?.currency ?? 'USD'
    };
  }

  async cancel(
    providerSubscriptionId: string,
    mode: CancelMode
  ): Promise<void> {
    const paddle = this.requireClient();
    await paddle.subscriptions.cancel(providerSubscriptionId, {
      effectiveFrom:
        mode === 'immediate' ? 'immediately' : 'next_billing_period'
    });
  }

  async refund(providerInvoiceRef: string, amountMinor: number): Promise<void> {
    const paddle = this.requireClient();
    const transaction = await paddle.transactions.get(providerInvoiceRef);
    const total = Number(transaction.details?.totals?.total ?? '0');

    if (!amountMinor || amountMinor >= total) {
      await paddle.adjustments.create({
        transactionId: providerInvoiceRef,
        action: 'refund',
        type: 'full',
        reason: 'Refund'
      });
      return;
    }

    // Our subscription transactions carry a single line item (one plan price),
    // so a partial refund applies the amount to that item.
    const lineItem = transaction.details?.lineItems?.[0];
    if (!lineItem) {
      throw new ServiceUnavailableException(
        `Transaction ${providerInvoiceRef} has no line item to refund`
      );
    }
    await paddle.adjustments.create({
      transactionId: providerInvoiceRef,
      action: 'refund',
      type: 'partial',
      reason: 'Refund',
      items: [
        { itemId: lineItem.id, type: 'partial', amount: String(amountMinor) }
      ]
    });
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<NormalizedEvent | null> {
    if (!this.paddle || !this.webhookSecret) {
      return null;
    }
    const signature = firstHeader(headers['paddle-signature']);
    if (!signature) {
      return null;
    }

    try {
      const event = await this.paddle.webhooks.unmarshal(
        rawBody.toString('utf8'),
        this.webhookSecret,
        signature
      );
      return event ? this.normalize(event) : null;
    } catch (error) {
      this.logger.warn(
        `Paddle webhook verification failed: ${(error as Error).message}`
      );
      return null;
    }
  }

  /** Maps a verified Paddle event onto a provider-agnostic `NormalizedEvent`. */
  private normalize(event: {
    eventId: string;
    eventType: string;
    data: object;
  }): NormalizedEvent | null {
    const base = { provider: this.id, providerEventId: event.eventId };

    switch (event.eventType as EventName) {
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionCreated:
        return {
          ...base,
          type: 'subscription.activated',
          payload: this.subscriptionPayload(
            event.data as SubscriptionNotification
          )
        };
      case EventName.SubscriptionUpdated:
        return {
          ...base,
          type: 'subscription.renewed',
          payload: this.subscriptionPayload(
            event.data as SubscriptionNotification
          )
        };
      case EventName.SubscriptionPastDue:
        return {
          ...base,
          type: 'subscription.past_due',
          payload: this.subscriptionPayload(
            event.data as SubscriptionNotification
          )
        };
      case EventName.SubscriptionCanceled:
        return {
          ...base,
          type: 'subscription.canceled',
          payload: this.subscriptionPayload(
            event.data as SubscriptionNotification
          )
        };
      case EventName.TransactionCompleted:
        return {
          ...base,
          type: 'invoice.paid',
          payload: this.invoicePayload(event.data as TransactionNotification)
        };
      case EventName.TransactionPaymentFailed: {
        const txn = event.data as TransactionNotification;
        const payload: NormalizedPaymentFailedPayload = {
          ref: refFromCustomData(txn.customData),
          providerSubscriptionId: txn.subscriptionId,
          usageChargeKey: usageChargeKeyFrom(txn)
        };
        return { ...base, type: 'payment.failed', payload };
      }
      default:
        // An event type we don't reduce — ignore it (no idempotency row).
        return null;
    }
  }

  private subscriptionPayload(
    sub: SubscriptionNotification
  ): NormalizedSubscriptionPayload {
    const planKey: unknown = sub.customData?.['planKey'];
    return {
      ref: refFromCustomData(sub.customData),
      providerSubscriptionId: sub.id,
      status: mapSubscriptionStatus(sub.status),
      planKey: typeof planKey === 'string' ? planKey : null,
      currentPeriodStart: sub.currentBillingPeriod?.startsAt ?? null,
      currentPeriodEnd: sub.currentBillingPeriod?.endsAt ?? null,
      cancelAtPeriodEnd: sub.scheduledChange?.action === 'cancel',
      trialEnd:
        sub.items.find((item) => item.trialDates)?.trialDates?.endsAt ?? null
    };
  }

  private invoicePayload(
    txn: TransactionNotification
  ): NormalizedInvoicePayload {
    return {
      ref: refFromCustomData(txn.customData),
      providerInvoiceRef: txn.id,
      providerSubscriptionId: txn.subscriptionId,
      amountMinor: Number(txn.details?.totals?.total ?? '0'),
      currency: txn.currencyCode,
      periodStart: txn.billingPeriod?.startsAt ?? null,
      periodEnd: txn.billingPeriod?.endsAt ?? null,
      paidAt: txn.billedAt,
      usageChargeKey: usageChargeKeyFrom(txn)
    };
  }
}
