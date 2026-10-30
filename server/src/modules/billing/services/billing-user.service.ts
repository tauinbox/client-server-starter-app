import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import {
  geoFromLocale,
  meteredWindowStart,
  overrideForRegion,
  regionForOverride
} from '@app/shared/utils/billing-rules';
import {
  BILLING_PROVIDER_FLAGS,
  ENTITLED_SUBSCRIPTION_STATUSES,
  ErrorKeys,
  INVOICE_LIST_QUERY,
  OPEN_SUBSCRIPTION_STATUSES
} from '@app/shared/constants';
import type {
  BillingRegion,
  BillingRegionResponse,
  CancelMode,
  CheckoutSessionResponse,
  ProductPrice,
  PurchaseSessionResponse
} from '@app/shared/types';
import { CursorPaginatedResponseDto } from '../../../common/dtos';
import { applyList } from '../../../common/utils/apply-list-query.util';
import { isUniqueViolation } from '../../../common/utils/is-unique-violation.util';
import { User } from '../../users/entities/user.entity';
import { CreditBalance } from '../entities/credit-balance.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import { Plan } from '../entities/plan.entity';
import { Product } from '../entities/product.entity';
import { Subscription } from '../entities/subscription.entity';
import { UsageRating } from '../rating/usage-rating.strategy';
import type { UsageSummaryResponseDto } from '../dtos/usage-summary-response.dto';
import { addInterval } from '../utils/period.util';
import {
  currentPlanMissing,
  planNotFound,
  subscriptionNotLinked
} from '../utils/billing-errors.util';
import { cancelOpenSubscription } from '../utils/cancel-subscription.util';
import {
  findOpenSubscription,
  requireOpenSubscription
} from '../utils/open-subscription.util';
import { INVOICE_LIST_COLUMNS } from '../utils/list-order.util';
import type { InvoiceCursorQueryDto } from '../dtos/billing-cursor-query.dto';
import { RenewalService } from '../renewals/renewal.service';
import { BillingService } from '../billing.service';
import { CreditService } from './credit.service';
import { ApiError } from '../../../common/errors/api-error';

function alreadySubscribed(): ApiError {
  return new ApiError(
    ErrorKeys.BILLING.ALREADY_SUBSCRIBED,
    'You already have an active subscription. Cancel it before subscribing to another plan.'
  );
}

function regionChangeBlocked(): ApiError {
  return new ApiError(
    ErrorKeys.BILLING.REGION_CHANGE_BLOCKED,
    'Cancel the current subscription before changing your billing region.'
  );
}

/**
 * One-time product types listed in the purchase catalog.
 * `custom` is listed too: its price entry carries the amount bounds and
 * currency the donation form renders — the client must not hardcode money.
 */
const LISTED_PRODUCT_TYPES = ['sku', 'credits', 'custom'] as const;

/**
 * Receipt text travels into provider receipts and 54-FZ fiscal documents —
 * strip markup-capable and control characters, keep it plain prose.
 */
function sanitizeReceiptText(text: string): string {
  return (
    text
      .replace(/\s+/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[<>\u0000-\u001f\u007f]/g, '')
      .trim()
  );
}

/**
 * User-scoped billing self-service. Every read and mutation is
 * keyed on the caller's `userId` — the customer is resolved from it, never from a
 * client-supplied id, so there is no IDOR surface. Checkout creates the local
 * subscription for the self-managed (YooKassa) provider before redirecting; the
 * provider-managed (Paddle) subscription is materialized by its webhook.
 */
@Injectable()
export class BillingUserService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(PaymentMethod)
    private readonly paymentMethods: Repository<PaymentMethod>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly billing: BillingService,
    private readonly renewals: RenewalService,
    private readonly credits: CreditService,
    private readonly usageRating: UsageRating,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2
  ) {}

  private readonly logger = new Logger(BillingUserService.name);

  async getCurrentSubscription(userId: string): Promise<Subscription | null> {
    const customer = await this.customerFor(userId);
    if (!customer) return null;
    return findOpenSubscription(this.subscriptions, customer.id);
  }

  async listInvoices(
    userId: string,
    query: InvoiceCursorQueryDto
  ): Promise<CursorPaginatedResponseDto<Invoice>> {
    const customer = await this.customerFor(userId);
    if (!customer) {
      return new CursorPaginatedResponseDto<Invoice>([], null, query.limit);
    }

    const qb = this.invoices
      .createQueryBuilder('invoice')
      .where('invoice.customerId = :customerId', { customerId: customer.id });
    return applyList(qb, INVOICE_LIST_QUERY, INVOICE_LIST_COLUMNS, query);
  }

  /**
   * The caller's metered usage aggregated over the current billing period.
   * Null when there is nothing to meter: no customer, no open subscription, or
   * a fixed-mode one. A dangling `planKey` also yields null — a read must not
   * surface a data-integrity error.
   */
  async getUsageSummary(
    userId: string
  ): Promise<UsageSummaryResponseDto | null> {
    const customer = await this.customerFor(userId);
    if (!customer) return null;
    const subscription = await findOpenSubscription(
      this.subscriptions,
      customer.id
    );
    if (!subscription || subscription.billingMode !== 'usage') return null;
    const plan = await this.plans.findOne({
      where: { key: subscription.planKey }
    });
    if (!plan) return null;

    const windowStart = meteredWindowStart(subscription);
    const summary = await this.usageRating.summarizeForPeriod(
      subscription,
      plan,
      { start: windowStart, end: subscription.currentPeriodEnd }
    );
    return {
      subscriptionId: subscription.id,
      meterKey: plan.meterKey,
      periodStart: windowStart,
      periodEnd: subscription.currentPeriodEnd,
      totalUnits: summary.totalUnits,
      includedUnits: summary.includedUnits,
      billableUnits: summary.billableUnits,
      unitPriceMinor: summary.unitPriceMinor,
      amountMinor: summary.amountMinor,
      currency: summary.currency
    };
  }

  /**
   * The caller's prepaid credit balance, or null when nothing was ever
   * purchased — the client renders that as zero credits.
   */
  async getCredits(userId: string): Promise<CreditBalance | null> {
    const customer = await this.customerFor(userId);
    if (!customer) return null;
    return this.credits.getBalance(customer.id);
  }

  async getDefaultPaymentMethod(userId: string): Promise<PaymentMethod | null> {
    const customer = await this.customerFor(userId);
    if (!customer?.defaultPaymentMethodId) return null;
    return this.paymentMethods.findOne({
      where: { id: customer.defaultPaymentMethodId, customerId: customer.id }
    });
  }

  /**
   * The one-time purchase catalog: active products that carry
   * a price entry for the caller's effective provider — fixed-price
   * `sku`/`credits` plus `custom`, whose entry holds the amount bounds the
   * donation form needs. Like `getRegion`, this is a read — it resolves the
   * provider without asserting availability, so the catalog stays browsable
   * while a provider is disabled.
   */
  async listProducts(userId: string): Promise<Product[]> {
    const customer = await this.customerFor(userId);
    const providerId = customer
      ? this.billing.effectiveProviderId(customer)
      : this.billing.geoDefaultFor(await this.detectCountry(userId));

    const products = await this.products.find({
      where: { active: true, type: In([...LISTED_PRODUCT_TYPES]) },
      order: { createdAt: 'ASC' }
    });
    return products.filter((product) => product.prices[providerId]);
  }

  /**
   * Starts a standalone one-time purchase: resolves the
   * provider (availability-asserting, like checkout) and opens the provider's
   * one-time payment, so the paid webhook reduces onto a `kind 'one_time'`
   * invoice and applies the grant. The server is price-authoritative for
   * fixed-price products: a client-sent amount is ignored; `custom` amounts
   * are validated against the product's bounds.
   */
  async purchase(
    userId: string,
    request: { productKey: string; amountMinor?: number; description?: string }
  ): Promise<PurchaseSessionResponse> {
    const product = await this.products.findOne({
      where: { key: request.productKey }
    });
    if (!product || !product.active) {
      throw new ApiError(
        ErrorKeys.BILLING.PRODUCT_NOT_FOUND,
        `Product "${request.productKey}" was not found`
      );
    }

    const customer = await this.getOrCreateCustomer(userId);
    const provider = await this.billing.resolveProvider(customer);

    const price = product.prices[provider.id];
    if (!price) {
      throw new ApiError(
        ErrorKeys.BILLING.PRODUCT_UNAVAILABLE_FOR_PROVIDER,
        `Product "${product.key}" is not available for your billing provider.`
      );
    }

    const amountMinor = this.resolvePurchaseAmount(
      product,
      price,
      request.amountMinor
    );
    // The Paddle webhook grants the product it finds by the paid catalog
    // price id; an inline price would pay for a grant it cannot match.
    if (
      provider.id === 'paddle' &&
      product.type !== 'custom' &&
      !price.paddlePriceId
    ) {
      throw new ApiError(
        ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED,
        `Product "${product.key}" has no Paddle price configured`
      );
    }
    const description = this.purchaseDescription(product, request.description);

    const session = await provider.createOneTimePayment(customer, {
      amountMinor,
      currency: price.currency,
      description,
      receiptItems: [{ description, amountMinor, quantity: 1 }],
      productId: product.id,
      urls: {
        successUrl: this.checkoutUrl('success'),
        cancelUrl: this.checkoutUrl('cancel')
      },
      paddlePriceId: price.paddlePriceId
    });
    return {
      provider: provider.id,
      url: session.url ?? null,
      sessionRef: session.sessionRef
    };
  }

  /**
   * The amount actually charged (threat model: amount tampering).
   * Fixed-price products charge the catalog price; `custom` requires a client
   * amount inside the product's configured bounds.
   */
  private resolvePurchaseAmount(
    product: Product,
    price: ProductPrice,
    requestedMinor: number | undefined
  ): number {
    if (product.type !== 'custom') {
      if (!price.amountMinor || price.amountMinor <= 0) {
        throw new ApiError(
          ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED,
          `Product "${product.key}" has no price configured`
        );
      }
      return price.amountMinor;
    }

    const { minAmountMinor, maxAmountMinor } = price;
    // `== null`, not falsy: a configured lower bound of 0 (any amount the
    // request DTO already accepts) is a legitimate setting, not "unconfigured".
    if (minAmountMinor == null || maxAmountMinor == null) {
      throw new ApiError(
        ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED,
        `Product "${product.key}" has no amount bounds configured`
      );
    }
    if (requestedMinor === undefined) {
      throw new ApiError(
        ErrorKeys.BILLING.AMOUNT_REQUIRED,
        'amountMinor is required for a custom-amount product'
      );
    }
    if (requestedMinor < minAmountMinor || requestedMinor > maxAmountMinor) {
      throw new ApiError(
        ErrorKeys.BILLING.AMOUNT_OUT_OF_RANGE,
        `amountMinor must be between ${minAmountMinor} and ${maxAmountMinor}`
      );
    }
    return requestedMinor;
  }

  /**
   * The receipt line text: the product name, with the buyer's note appended on
   * a custom purchase — sanitized, since it lands in fiscal documents.
   */
  private purchaseDescription(product: Product, note?: string): string {
    if (product.type !== 'custom' || !note) {
      return product.name;
    }
    const sanitized = sanitizeReceiptText(note);
    return sanitized
      ? `${product.name}: ${sanitized}`.slice(0, 128)
      : product.name;
  }

  async checkout(
    userId: string,
    planKey: string
  ): Promise<CheckoutSessionResponse> {
    const plan = await this.plans.findOne({ where: { key: planKey } });
    if (!plan || !plan.active) {
      throw planNotFound(planKey);
    }

    const customer = await this.getOrCreateCustomer(userId);

    // Re-checkout while an access-granting subscription exists is blocked.
    const active = await this.subscriptions.findOne({
      where: {
        customerId: customer.id,
        status: In([...ENTITLED_SUBSCRIPTION_STATUSES])
      }
    });
    if (active) {
      throw alreadySubscribed();
    }

    // resolveProvider asserts the geo's provider is configured
    // (`PROVIDER_NOT_CONFIGURED`) and enabled (`PROVIDER_UNAVAILABLE`), the
    // server-side enforcement behind the UI availability gating.
    const provider = await this.billing.resolveProvider(customer);
    const trial = plan.trialDays > 0 && !customer.trialUsedAt;

    // A prior unpaid checkout leaves an `incomplete` row. Reuse it rather than
    // stack a second open subscription (forbidden by UQ_subscriptions_customer_open).
    const pending = await this.subscriptions.findOne({
      where: { customerId: customer.id, status: 'incomplete' }
    });

    // Self-managed (YooKassa) has no provider-side subscription object, so the
    // local row is created here in `incomplete`; the success webhook flips it to
    // active. Provider-managed (Paddle) rows are created by the webhook reducer.
    if (!provider.managesLifecycle) {
      const now = new Date();
      const fields = {
        planKey: plan.key,
        provider: provider.id,
        billingMode: plan.billingMode,
        status: 'incomplete' as const,
        lifecycleOwner: 'self' as const,
        currentPeriodStart: now,
        currentPeriodEnd: addInterval(now, plan.interval),
        // Every later boundary is derived from this day, so a February clamp
        // cannot walk a month-end customer permanently backwards.
        billingAnchorAt: now,
        cancelAtPeriodEnd: false,
        trialEnd: trial
          ? new Date(now.getTime() + plan.trialDays * 86_400_000)
          : null,
        providerSubscriptionId: null,
        paymentMethodId: null
      };
      if (pending) {
        await this.reuseIncompleteRow(pending, fields);
      } else {
        try {
          await this.subscriptions.save(
            this.subscriptions.create({ customerId: customer.id, ...fields })
          );
        } catch (error: unknown) {
          // Lost the insert race against a concurrent checkout: the partial
          // unique index rejected the second open row.
          if (isUniqueViolation(error)) {
            throw alreadySubscribed();
          }
          throw error;
        }
      }
    } else if (pending) {
      // The region now resolves a provider-managed plan; release the stale
      // self `incomplete` so the provider's activation webhook isn't blocked.
      await this.reuseIncompleteRow(pending, { status: 'canceled' });
    }

    const session = await provider.startCheckout(
      customer,
      plan,
      {
        successUrl: this.checkoutUrl('success'),
        cancelUrl: this.checkoutUrl('cancel')
      },
      trial
    );
    return {
      provider: provider.id,
      url: session.url,
      sessionRef: session.sessionRef
    };
  }

  /**
   * Rewrites a leftover `incomplete` row, but only while it still is one. The
   * row was read before the provider was resolved, and the first-payment webhook
   * can activate it inside that window — committing the whole entity would put a
   * paid subscription back to `incomplete` with no period and no payment method,
   * outside both the entitled statuses and the renewal sweep. On a miss the
   * customer does have a live subscription, and `onMiss` is the caller's
   * refusal for that case.
   */
  private async reuseIncompleteRow(
    pending: Subscription,
    fields: QueryDeepPartialEntity<Subscription>,
    onMiss: () => ApiError = alreadySubscribed
  ): Promise<void> {
    const applied = await this.subscriptions.update(
      { id: pending.id, status: 'incomplete' },
      fields
    );
    if (applied.affected !== 1) {
      throw onMiss();
    }
  }

  /**
   * Starts the payment-method update flow for the caller's open
   * subscription. Dispatched on the subscription's provider (like cancel) —
   * not the region-resolved one, which may differ after an override change.
   * Paddle hosts the change on its zero-amount checkout; YooKassa re-binds the
   * card with a zero-amount payment whose success webhook swaps the default.
   * `past_due` is deliberately allowed: fixing the card is how dunning recovers.
   */
  async startPaymentMethodUpdate(
    userId: string
  ): Promise<CheckoutSessionResponse> {
    const { customer, subscription } = await requireOpenSubscription(
      { customers: this.customers, subscriptions: this.subscriptions },
      userId,
      'No active subscription to update the payment method for'
    );

    const provider = this.billing.getProviderById(subscription.provider);
    if (provider.managesLifecycle && !subscription.providerSubscriptionId) {
      throw subscriptionNotLinked();
    }
    const plan = await this.plans.findOne({
      where: { key: subscription.planKey }
    });
    const price = plan?.prices[subscription.provider];
    if (!price) {
      throw currentPlanMissing();
    }

    const session = await provider.updatePaymentMethod(
      subscription.providerSubscriptionId,
      customer,
      price.currency,
      {
        successUrl: this.settingsUrl(),
        cancelUrl: this.settingsUrl()
      }
    );
    return {
      provider: provider.id,
      url: session.url,
      sessionRef: session.sessionRef
    };
  }

  async cancelSubscription(
    userId: string,
    mode: CancelMode = 'period_end'
  ): Promise<Subscription> {
    const { subscription } = await requireOpenSubscription(
      { customers: this.customers, subscriptions: this.subscriptions },
      userId,
      'No active subscription to cancel'
    );
    return cancelOpenSubscription(
      {
        subscriptions: this.subscriptions,
        billing: this.billing,
        renewals: this.renewals,
        credits: this.credits,
        events: this.events
      },
      subscription,
      mode,
      () => Promise.resolve(userId)
    );
  }

  async getRegion(userId: string): Promise<BillingRegionResponse> {
    const customer = await this.customerFor(userId);
    if (customer) return this.regionView(userId, customer);

    // No customer yet: report the geo default derived from the registration
    // locale; nothing is persisted until the first checkout / region change.
    const country = await this.detectCountry(userId);
    return this.regionView(userId, { providerOverride: null, country });
  }

  async setRegion(
    userId: string,
    region: BillingRegion
  ): Promise<BillingRegionResponse> {
    const customer = await this.getOrCreateCustomer(userId);
    const newOverride = overrideForRegion(region);
    const newEffective =
      newOverride ?? this.billing.geoDefaultFor(customer.country);

    // Checked before the subscription guard: telling the user to cancel for a
    // region that checkout would then refuse leaves them with nothing.
    if (!(await this.billing.isProviderAvailable(newEffective, userId))) {
      throw new ApiError(
        ErrorKeys.BILLING.REGION_UNAVAILABLE,
        'Payments are not available in this billing region.'
      );
    }

    // No in-place cross-provider migration: if a live subscription
    // is on a different provider than the new region resolves to, reject.
    // An unpaid self-managed checkout is released instead, as checkout does;
    // a provider-owned `incomplete` row has a subscription at the provider.
    const open = await this.subscriptions.findOne({
      where: {
        customerId: customer.id,
        status: In([...OPEN_SUBSCRIPTION_STATUSES])
      }
    });
    if (open && open.provider !== newEffective) {
      if (open.status !== 'incomplete' || open.lifecycleOwner !== 'self') {
        throw regionChangeBlocked();
      }
      await this.reuseIncompleteRow(
        open,
        { status: 'canceled' },
        regionChangeBlocked
      );
    }

    // The override is the only column this call owns; saving the entity would
    // write back everything read before the lookup above, and a payment-method
    // webhook committing in that window would lose `defaultPaymentMethodId` -
    // leaving the customer with no autopay token at all.
    await this.customers.update(
      { id: customer.id },
      { providerOverride: newOverride }
    );
    const updated =
      (await this.customers.findOne({ where: { id: customer.id } })) ??
      Object.assign(customer, { providerOverride: newOverride });
    return this.regionView(userId, updated);
  }

  private async regionView(
    userId: string,
    customer: Pick<Customer, 'providerOverride' | 'country'>
  ): Promise<BillingRegionResponse> {
    const availability = await Promise.all(
      BILLING_PROVIDER_FLAGS.map(({ provider }) =>
        this.billing.isProviderAvailable(provider, userId)
      )
    );
    return {
      region: regionForOverride(customer.providerOverride),
      detectedProvider: this.billing.geoDefaultFor(customer.country),
      effectiveProvider: this.billing.effectiveProviderId(customer),
      availableProviders: BILLING_PROVIDER_FLAGS.filter(
        (_, i) => availability[i]
      ).map(({ provider }) => provider)
    };
  }

  /** Finds-or-creates the billing customer for a user (geo from locale). */
  private async getOrCreateCustomer(userId: string): Promise<Customer> {
    const existing = await this.customers.findOne({ where: { userId } });
    if (existing) return existing;

    const geo = await this.detectGeo(userId);
    if (!geo) {
      throw new ApiError(ErrorKeys.USERS.NOT_FOUND, 'User not found');
    }
    const { country, currency } = geo;
    try {
      return await this.customers.save(
        this.customers.create({
          userId,
          provider: this.billing.geoDefaultFor(country),
          providerOverride: null,
          country,
          currency,
          providerCustomerId: null,
          defaultPaymentMethodId: null,
          trialUsedAt: null
        })
      );
    } catch (error: unknown) {
      // Lost the insert race against a concurrent first billing action:
      // the unique constraint on user_id rejected the second row. Return
      // the row the winner created.
      if (isUniqueViolation(error)) {
        const winner = await this.customers.findOne({ where: { userId } });
        if (winner) return winner;
      }
      throw error;
    }
  }

  /** The caller's billing customer, or null when none was ever created. */
  private async customerFor(userId: string): Promise<Customer | null> {
    return this.customers.findOne({ where: { userId } });
  }

  private async detectCountry(userId: string): Promise<string> {
    return ((await this.detectGeo(userId)) ?? geoFromLocale('en')).country;
  }

  /** The billing geo of the user's locale; null when the user is gone. */
  private async detectGeo(
    userId: string
  ): Promise<{ country: string; currency: string } | null> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, locale: true }
    });
    return user ? geoFromLocale(user.locale) : null;
  }

  // Must match the client's checkout-return routes (/billing/success|cancel).
  private checkoutUrl(outcome: 'success' | 'cancel'): string {
    return `${this.clientBaseUrl()}/billing/${outcome}`;
  }

  /** Where a method-update flow returns to — the billing settings page. */
  private settingsUrl(): string {
    return `${this.clientBaseUrl()}/billing/settings`;
  }

  private clientBaseUrl(): string {
    const base =
      this.config.get<string>('CLIENT_URL') ?? 'http://localhost:4200';
    return base.replace(/\/$/, '');
  }
}
