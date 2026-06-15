import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type {
  BillingProviderId,
  BillingRegion,
  CheckoutSessionResponse,
  ProductPrice,
  ProrationPreviewResponse,
  PurchaseSessionResponse
} from '@app/shared/types';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { User } from '../../users/entities/user.entity';
import { CreditBalance } from '../entities/credit-balance.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import { Plan } from '../entities/plan.entity';
import { Product } from '../entities/product.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PlanChangedEvent,
  SubscriptionCanceledEvent
} from '../events/billing.events';
import type {
  CancelMode,
  PaymentProvider
} from '../providers/payment-provider.interface';
import { ProrationCalculator } from '../rating/proration-calculator';
import { UsageRating } from '../rating/usage-rating.strategy';
import type { UsageSummaryResponseDto } from '../dtos/usage-summary-response.dto';
import { addInterval } from '../utils/period.util';
import { BillingService } from '../billing.service';
import { CreditService } from './credit.service';

/** Subscriptions that grant access — re-checkout while one exists is blocked. */
const ACTIVE_STATUSES = ['trialing', 'active', 'past_due'] as const;

/** Non-canceled statuses — the "current" subscription for read/cancel/region. */
const OPEN_STATUSES = ['incomplete', 'trialing', 'active', 'past_due'] as const;

/**
 * Statuses a plan change is allowed from. `past_due` must settle its debt first
 * (a switch would tangle proration with dunning); `incomplete` has nothing to
 * prorate yet.
 */
const CHANGEABLE_STATUSES = ['trialing', 'active'] as const;

/** Everything a plan change / proration preview operates on. */
interface ChangeContext {
  customer: Customer;
  subscription: Subscription;
  fromPlan: Plan;
  toPlan: Plan;
  provider: PaymentProvider;
}

/** Maps the user's registration locale to a billing country + currency. */
function geoFromLocale(locale: string): { country: string; currency: string } {
  return locale.toLowerCase().startsWith('ru')
    ? { country: 'RU', currency: 'RUB' }
    : { country: 'US', currency: 'USD' };
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

/** Region selector ⇄ provider override. */
function overrideForRegion(region: BillingRegion): BillingProviderId | null {
  if (region === 'ru') return 'yookassa';
  if (region === 'world') return 'paddle';
  return null;
}

function regionForOverride(override: BillingProviderId | null): BillingRegion {
  if (override === 'yookassa') return 'ru';
  if (override === 'paddle') return 'world';
  return 'auto';
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
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly billing: BillingService,
    private readonly credits: CreditService,
    private readonly usageRating: UsageRating,
    private readonly proration: ProrationCalculator,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2
  ) {}

  private readonly logger = new Logger(BillingUserService.name);

  async getCurrentSubscription(userId: string): Promise<Subscription | null> {
    const customer = await this.customers.findOne({ where: { userId } });
    if (!customer) return null;
    return this.findCurrentSubscription(customer.id);
  }

  async listInvoices(userId: string): Promise<Invoice[]> {
    const customer = await this.customers.findOne({ where: { userId } });
    if (!customer) return [];
    return this.invoices.find({
      where: { customerId: customer.id },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * The caller's metered usage aggregated over the current billing period.
   * Null when there is nothing to meter: no customer, no open subscription, or
   * a fixed-mode one. A dangling `planKey` also yields null — a read must not
   * surface a data-integrity 500.
   */
  async getUsageSummary(
    userId: string
  ): Promise<UsageSummaryResponseDto | null> {
    const customer = await this.customers.findOne({ where: { userId } });
    if (!customer) return null;
    const subscription = await this.findCurrentSubscription(customer.id);
    if (!subscription || subscription.billingMode !== 'usage') return null;
    const plan = await this.plans.findOne({
      where: { key: subscription.planKey }
    });
    if (!plan) return null;

    const summary = await this.usageRating.summarizeForPeriod(
      subscription,
      plan,
      {
        start: subscription.currentPeriodStart,
        end: subscription.currentPeriodEnd
      }
    );
    return {
      subscriptionId: subscription.id,
      meterKey: plan.meterKey,
      periodStart: subscription.currentPeriodStart,
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
    const customer = await this.customers.findOne({ where: { userId } });
    if (!customer) return null;
    return this.credits.getBalance(customer.id);
  }

  async getDefaultPaymentMethod(userId: string): Promise<PaymentMethod | null> {
    const customer = await this.customers.findOne({ where: { userId } });
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
    const customer = await this.customers.findOne({ where: { userId } });
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
   * one-time payment with the product id round-tripped through custom data so
   * the paid webhook reduces onto a `kind 'one_time'` invoice and applies the
   * grant. The server is price-authoritative for fixed-price products — a
   * client-sent amount is ignored; `custom` amounts are validated against the
   * product's bounds.
   */
  async purchase(
    userId: string,
    request: { productKey: string; amountMinor?: number; description?: string }
  ): Promise<PurchaseSessionResponse> {
    const product = await this.products.findOne({
      where: { key: request.productKey }
    });
    if (!product || !product.active) {
      throw new NotFoundException(
        `Product "${request.productKey}" was not found`
      );
    }

    const customer = await this.getOrCreateCustomer(userId);
    const provider = await this.billing.resolveProvider(customer);

    const price = product.prices[provider.id];
    if (!price) {
      throw new ConflictException(
        `Product "${product.key}" is not available for your billing provider.`
      );
    }

    const amountMinor = this.resolvePurchaseAmount(
      product,
      price,
      request.amountMinor
    );
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
        throw new ServiceUnavailableException(
          `Product "${product.key}" has no price configured`
        );
      }
      return price.amountMinor;
    }

    const { minAmountMinor, maxAmountMinor } = price;
    if (!minAmountMinor || !maxAmountMinor) {
      throw new ServiceUnavailableException(
        `Product "${product.key}" has no amount bounds configured`
      );
    }
    if (requestedMinor === undefined) {
      throw new BadRequestException(
        'amountMinor is required for a custom-amount product'
      );
    }
    if (requestedMinor < minAmountMinor || requestedMinor > maxAmountMinor) {
      throw new BadRequestException(
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
      throw new NotFoundException(`Plan "${planKey}" was not found`);
    }

    const customer = await this.getOrCreateCustomer(userId);

    const active = await this.subscriptions.findOne({
      where: { customerId: customer.id, status: In([...ACTIVE_STATUSES]) }
    });
    if (active) {
      throw new ConflictException(
        'You already have an active subscription. Cancel it before subscribing to another plan.'
      );
    }

    // resolveProvider asserts the geo's provider is enabled + configured (503),
    // the server-side enforcement behind the UI availability gating.
    const provider = await this.billing.resolveProvider(customer);

    // Self-managed (YooKassa) has no provider-side subscription object, so the
    // local row is created here in `incomplete`; the success webhook flips it to
    // active. Provider-managed (Paddle) rows are created by the webhook reducer.
    if (!provider.managesLifecycle) {
      const now = new Date();
      await this.subscriptions.save(
        this.subscriptions.create({
          customerId: customer.id,
          planKey: plan.key,
          provider: provider.id,
          billingMode: plan.billingMode,
          status: 'incomplete',
          lifecycleOwner: 'self',
          currentPeriodStart: now,
          currentPeriodEnd: addInterval(now, plan.interval),
          cancelAtPeriodEnd: false,
          trialEnd:
            plan.trialDays > 0
              ? new Date(now.getTime() + plan.trialDays * 86_400_000)
              : null,
          providerSubscriptionId: null,
          paymentMethodId: null
        })
      );
    }

    const session = await provider.startCheckout(customer, plan, {
      successUrl: this.checkoutUrl('success'),
      cancelUrl: this.checkoutUrl('cancel')
    });
    return {
      provider: provider.id,
      url: session.url,
      sessionRef: session.sessionRef
    };
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
    const customer = await this.customers.findOne({ where: { userId } });
    const subscription = customer
      ? await this.findCurrentSubscription(customer.id)
      : null;
    if (!customer || !subscription) {
      throw new NotFoundException(
        'No active subscription to update the payment method for'
      );
    }

    const provider = this.billing.getProviderById(subscription.provider);
    if (!provider) {
      throw new ServiceUnavailableException(
        `Billing provider "${subscription.provider}" is not registered`
      );
    }
    if (provider.managesLifecycle && !subscription.providerSubscriptionId) {
      throw new ConflictException(
        'The subscription is not linked to the provider yet. Try again shortly.'
      );
    }

    const session = await provider.updatePaymentMethod(
      subscription.providerSubscriptionId,
      customer,
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
    const customer = await this.customers.findOne({ where: { userId } });
    const subscription = customer
      ? await this.findCurrentSubscription(customer.id)
      : null;
    if (!subscription) {
      throw new NotFoundException('No active subscription to cancel');
    }

    // Provider-managed lifecycle: ask the provider to cancel; the resulting
    // webhook reconciles status. Self-managed: there is no provider object — the
    // renewal scheduler simply stops charging the saved card.
    if (subscription.providerSubscriptionId) {
      const provider = this.billing.getProviderById(subscription.provider);
      if (provider) {
        await provider.cancel(subscription.providerSubscriptionId, mode);
      }
    }

    if (mode === 'immediate') {
      subscription.status = 'canceled';
      subscription.cancelAtPeriodEnd = false;
    } else {
      subscription.cancelAtPeriodEnd = true;
    }
    const saved = await this.subscriptions.save(subscription);

    if (mode === 'immediate') {
      this.events.emit(
        SubscriptionCanceledEvent.name,
        new SubscriptionCanceledEvent(userId, saved.id)
      );
    }
    return saved;
  }

  /**
   * Instant plan/mode change with proration. Paddle
   * delegates the money side (`subscriptions.update`, prorated immediately) and
   * the local row is updated optimistically — the provider's webhooks confirm.
   * YooKassa is computed here: charge the new plan's prorated remainder first
   * (the failure-prone leg — a declined card aborts the switch with nothing
   * moved), then refund the old plan's unused remainder; each leg is its own
   * fiscal document and its own local invoice row. A refund failure after a
   * successful charge is logged and the switch proceeds — the admin console can
   * re-issue the refund, while reverting would double-tangle the money.
   */
  async changePlan(userId: string, planKey: string): Promise<Subscription> {
    const ctx = await this.resolveChangeContext(userId, planKey);
    const { customer, subscription, fromPlan, toPlan, provider } = ctx;

    if (provider.managesLifecycle) {
      if (!subscription.providerSubscriptionId) {
        throw new ConflictException(
          'The subscription is not linked to the provider yet. Try again shortly.'
        );
      }
      // Serialize against a concurrent change on the same row before delegating.
      await this.claimChange(subscription);
      await provider.changePlan(
        subscription.providerSubscriptionId,
        customer,
        toPlan
      );
      return this.applyPlanChange(ctx);
    }

    // Trial: nothing has been charged yet, so a switch moves no money.
    const quote =
      subscription.status === 'trialing'
        ? null
        : this.proration.quote({
            fromPlan,
            toPlan,
            provider: provider.id,
            periodStart: subscription.currentPeriodStart,
            periodEnd: subscription.currentPeriodEnd,
            now: new Date()
          });

    // Claim the change before any money moves: a concurrent change to a
    // different plan loses this compare-and-swap and is rejected here, so the
    // provider is never asked for a second, conflicting charge.
    await this.claimChange(subscription);

    const periodEndMs = subscription.currentPeriodEnd.getTime();
    const chargeKey = `change-charge:${subscription.id}:${toPlan.key}:${periodEndMs}`;
    const refundKey = `change-refund:${subscription.id}:${toPlan.key}:${periodEndMs}`;

    // Resolve the refund source BEFORE creating the new charge: the proration
    // refund must target the invoice that paid for the outgoing plan's current
    // coverage, never the charge we are about to record for the incoming plan.
    const refund =
      quote && quote.refundMinor > 0
        ? await this.resolveRefund(subscription, quote.refundMinor)
        : null;

    // External legs run outside the DB transaction — a provider HTTP call must
    // never be held inside an open transaction. Both keys are stable across
    // retries so a replay reconciles instead of charging/refunding twice.
    let chargeRef: string | null = null;
    if (quote && quote.chargeMinor > 0) {
      const charge = await provider.chargeOffSession(
        customer,
        quote.chargeMinor,
        quote.chargeItems,
        chargeKey
      );
      chargeRef = charge.providerInvoiceRef;
    }

    let refundIssued = false;
    if (refund) {
      try {
        await provider.refund(
          refund.source.providerInvoiceRef,
          refund.minor,
          refundKey
        );
        refundIssued = true;
      } catch (error) {
        // A refund failure after a successful charge never reverts the switch —
        // reverting would double-tangle the money; the admin console can re-issue.
        this.logger.error(
          `Proration refund failed for subscription ${subscription.id} (${refund.minor} minor): ${(error as Error).message}`
        );
      }
    }

    // Single transaction: both invoice legs, the partial-refund bookkeeping on
    // the source, and the plan apply commit together — a crash can't leave money
    // recorded without the plan applied, or the plan applied without the money.
    const chargeAmount = quote?.chargeMinor ?? 0;
    const { saved, chargeInvoiceId } = await withTransaction(
      this.dataSource,
      async (manager) => {
        let chargeInvoiceId: string | null = null;
        if (chargeRef) {
          chargeInvoiceId = await this.insertChangeInvoice(manager, {
            subscription,
            customer,
            providerEventId: chargeKey,
            providerInvoiceRef: chargeRef,
            amountMinor: chargeAmount,
            status: 'paid',
            billingMode: toPlan.billingMode
          });
        }
        if (refundIssued && refund) {
          await this.insertChangeInvoice(manager, {
            subscription,
            customer,
            providerEventId: refundKey,
            providerInvoiceRef: refund.source.providerInvoiceRef,
            amountMinor: refund.minor,
            status: 'refunded',
            billingMode: 'fixed'
          });
          // Record the partial refund on the source so an admin refund of the
          // same invoice can't give the money back a second time.
          await manager.update(
            Invoice,
            { id: refund.source.id },
            { refundedMinor: (refund.source.refundedMinor ?? 0) + refund.minor }
          );
        }
        subscription.planKey = toPlan.key;
        subscription.billingMode = toPlan.billingMode;
        const saved = await manager.save(Subscription, subscription);
        return { saved, chargeInvoiceId };
      }
    );

    this.events.emit(
      PlanChangedEvent.name,
      new PlanChangedEvent(customer.userId, saved.id, fromPlan.key, toPlan.key)
    );
    if (chargeInvoiceId) {
      this.events.emit(
        InvoicePaidEvent.name,
        new InvoicePaidEvent(userId, chargeInvoiceId)
      );
    }
    return saved;
  }

  /**
   * Compare-and-swap claim on the subscription's version: the first change to
   * land bumps it; a concurrent change that read the same version loses the CAS
   * and is rejected before any money moves. Stays out of the DB transaction so
   * no row lock is held across the provider HTTP call.
   */
  private async claimChange(subscription: Subscription): Promise<void> {
    const result = await this.subscriptions.update(
      {
        id: subscription.id,
        version: subscription.version,
        status: In([...CHANGEABLE_STATUSES]),
        cancelAtPeriodEnd: false
      },
      { version: subscription.version + 1 }
    );
    if (result.affected !== 1) {
      throw new ConflictException(
        'This subscription is already being updated. Please retry.'
      );
    }
    subscription.version += 1;
  }

  /**
   * What an instant switch to `planKey` would cost right now, without applying
   * it. Paddle answers via `previewUpdate` (net only); YooKassa is the local
   * calculator's split. The YooKassa credit shown is the uncapped remainder —
   * the executed refund may be capped by the original invoice's amount.
   */
  async previewChange(
    userId: string,
    planKey: string
  ): Promise<ProrationPreviewResponse> {
    const ctx = await this.resolveChangeContext(userId, planKey);
    const { subscription, fromPlan, toPlan, provider } = ctx;
    const base = {
      provider: provider.id,
      fromPlanKey: fromPlan.key,
      toPlanKey: toPlan.key
    };

    if (provider.managesLifecycle) {
      if (!subscription.providerSubscriptionId) {
        throw new ConflictException(
          'The subscription is not linked to the provider yet. Try again shortly.'
        );
      }
      const preview = await provider.previewChangePlan(
        subscription.providerSubscriptionId,
        toPlan
      );
      return {
        ...base,
        currency: preview.currency,
        creditMinor: null,
        chargeMinor: null,
        dueNowMinor: preview.amountMinor
      };
    }

    if (subscription.status === 'trialing') {
      const currency =
        toPlan.prices[provider.id]?.currency ?? ctx.customer.currency;
      return {
        ...base,
        currency,
        creditMinor: 0,
        chargeMinor: 0,
        dueNowMinor: 0
      };
    }

    const quote = this.proration.quote({
      fromPlan,
      toPlan,
      provider: provider.id,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      now: new Date()
    });
    return {
      ...base,
      currency: quote.currency,
      creditMinor: quote.refundMinor,
      chargeMinor: quote.chargeMinor,
      dueNowMinor: quote.chargeMinor - quote.refundMinor
    };
  }

  /** Resolves and guards everything a change/preview needs (shared path). */
  private async resolveChangeContext(
    userId: string,
    planKey: string
  ): Promise<ChangeContext> {
    const customer = await this.customers.findOne({ where: { userId } });
    const subscription = customer
      ? await this.findCurrentSubscription(customer.id)
      : null;
    if (!customer || !subscription) {
      throw new NotFoundException('No active subscription to change');
    }
    if (
      !(CHANGEABLE_STATUSES as readonly string[]).includes(subscription.status)
    ) {
      throw new ConflictException(
        'The subscription must be active to change plans. Settle any outstanding payment first.'
      );
    }
    if (subscription.cancelAtPeriodEnd) {
      throw new ConflictException(
        'A cancellation is scheduled for this subscription; it can no longer change plans.'
      );
    }

    const toPlan = await this.plans.findOne({ where: { key: planKey } });
    if (!toPlan || !toPlan.active) {
      throw new NotFoundException(`Plan "${planKey}" was not found`);
    }
    if (toPlan.key === subscription.planKey) {
      throw new ConflictException('You are already on this plan.');
    }
    if (!toPlan.prices[subscription.provider]) {
      throw new ConflictException(
        `Plan "${toPlan.key}" is not available for your billing provider.`
      );
    }

    const fromPlan = await this.plans.findOne({
      where: { key: subscription.planKey }
    });
    if (!fromPlan) {
      throw new ServiceUnavailableException(
        'The current plan is missing from the catalog'
      );
    }

    const provider = this.billing.getProviderById(subscription.provider);
    if (!provider) {
      throw new ServiceUnavailableException(
        `Billing provider "${subscription.provider}" is not registered`
      );
    }

    return { customer, subscription, fromPlan, toPlan, provider };
  }

  /**
   * Resolves the refund leg of a self-managed switch: the invoice that paid for
   * the outgoing plan's current coverage and how much of the computed remainder
   * is actually refundable against it. The amount is capped by what is still
   * unrefunded on that invoice (no source, or nothing left → no refund, e.g. a
   * period opened by a zero usage invoice). Resolved before the new charge is
   * recorded so the charge can't become its own refund source.
   */
  private async resolveRefund(
    subscription: Subscription,
    refundMinor: number
  ): Promise<{ source: Invoice; minor: number } | null> {
    const source = await this.invoices.findOne({
      where: {
        subscriptionId: subscription.id,
        status: 'paid',
        billingMode: 'fixed'
      },
      order: { createdAt: 'DESC' }
    });
    if (!source) return null;

    const refundable = source.amountMinor - (source.refundedMinor ?? 0);
    const minor = Math.min(refundMinor, refundable);
    if (minor <= 0) return null;
    return { source, minor };
  }

  /** Persists the new plan on the local row and publishes the change. */
  private async applyPlanChange(ctx: ChangeContext): Promise<Subscription> {
    const { customer, subscription, fromPlan, toPlan } = ctx;
    subscription.planKey = toPlan.key;
    subscription.billingMode = toPlan.billingMode;
    const saved = await this.subscriptions.save(subscription);
    this.events.emit(
      PlanChangedEvent.name,
      new PlanChangedEvent(customer.userId, saved.id, fromPlan.key, toPlan.key)
    );
    return saved;
  }

  /**
   * Records one leg of a self-managed switch as its own invoice row within the
   * caller's transaction (the two fiscal documents of the switch stay visible in
   * the history). The unique `providerEventId` makes a double-submitted change
   * insert each leg at most once.
   */
  private async insertChangeInvoice(
    manager: EntityManager,
    args: {
      subscription: Subscription;
      customer: Customer;
      providerEventId: string;
      providerInvoiceRef: string;
      amountMinor: number;
      status: 'paid' | 'refunded';
      billingMode: Plan['billingMode'];
    }
  ): Promise<string | null> {
    const { subscription, customer } = args;
    const now = new Date();
    const insert = await manager
      .createQueryBuilder()
      .insert()
      .into(Invoice)
      .values({
        customerId: subscription.customerId,
        subscriptionId: subscription.id,
        provider: subscription.provider,
        providerEventId: args.providerEventId,
        providerInvoiceRef: args.providerInvoiceRef,
        amountMinor: args.amountMinor,
        currency: customer.currency,
        status: args.status,
        billingMode: args.billingMode,
        periodStart: now,
        periodEnd: subscription.currentPeriodEnd,
        paidAt: now,
        receiptRef: null
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const rows = insert.raw as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  }

  async getRegion(userId: string): Promise<{
    region: BillingRegion;
    detectedProvider: BillingProviderId;
    effectiveProvider: BillingProviderId;
  }> {
    const customer = await this.customers.findOne({ where: { userId } });
    if (customer) {
      return {
        region: regionForOverride(customer.providerOverride),
        detectedProvider: this.billing.geoDefaultFor(customer.country),
        effectiveProvider: this.billing.effectiveProviderId(customer)
      };
    }

    // No customer yet: report the geo default derived from the registration
    // locale; nothing is persisted until the first checkout / region change.
    const country = await this.detectCountry(userId);
    const detected = this.billing.geoDefaultFor(country);
    return {
      region: 'auto',
      detectedProvider: detected,
      effectiveProvider: detected
    };
  }

  async setRegion(
    userId: string,
    region: BillingRegion
  ): Promise<{
    region: BillingRegion;
    detectedProvider: BillingProviderId;
    effectiveProvider: BillingProviderId;
  }> {
    const customer = await this.getOrCreateCustomer(userId);
    const newOverride = overrideForRegion(region);
    const newEffective =
      newOverride ?? this.billing.geoDefaultFor(customer.country);

    // No in-place cross-provider migration: if a live subscription
    // is on a different provider than the new region resolves to, reject.
    const open = await this.subscriptions.findOne({
      where: { customerId: customer.id, status: In([...OPEN_STATUSES]) }
    });
    if (open && open.provider !== newEffective) {
      throw new ConflictException(
        'Cancel the current subscription before changing your billing region.'
      );
    }

    customer.providerOverride = newOverride;
    await this.customers.save(customer);
    return {
      region: regionForOverride(customer.providerOverride),
      detectedProvider: this.billing.geoDefaultFor(customer.country),
      effectiveProvider: this.billing.effectiveProviderId(customer)
    };
  }

  /** Finds-or-creates the billing customer for a user (geo from locale). */
  private async getOrCreateCustomer(userId: string): Promise<Customer> {
    const existing = await this.customers.findOne({ where: { userId } });
    if (existing) return existing;

    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, locale: true }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { country, currency } = geoFromLocale(user.locale);
    return this.customers.save(
      this.customers.create({
        userId,
        provider: this.billing.geoDefaultFor(country),
        providerOverride: null,
        country,
        currency,
        providerCustomerId: null,
        defaultPaymentMethodId: null
      })
    );
  }

  private async findCurrentSubscription(
    customerId: string
  ): Promise<Subscription | null> {
    return this.subscriptions.findOne({
      where: { customerId, status: In([...OPEN_STATUSES]) },
      order: { createdAt: 'DESC' }
    });
  }

  private async detectCountry(userId: string): Promise<string> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, locale: true }
    });
    return geoFromLocale(user?.locale ?? 'en').country;
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
