import {
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type {
  BillingProviderId,
  BillingRegion,
  CheckoutSessionResponse
} from '@app/shared/types';
import { User } from '../../users/entities/user.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import type { CancelMode } from '../providers/payment-provider.interface';
import { UsageRating } from '../rating/usage-rating.strategy';
import type { UsageSummaryResponseDto } from '../dtos/usage-summary-response.dto';
import { addInterval } from '../utils/period.util';
import { BillingService } from '../billing.service';

/** Subscriptions that grant access — re-checkout while one exists is blocked. */
const ACTIVE_STATUSES = ['trialing', 'active', 'past_due'] as const;

/** Non-canceled statuses — the "current" subscription for read/cancel/region. */
const OPEN_STATUSES = ['incomplete', 'trialing', 'active', 'past_due'] as const;

/** Maps the user's registration locale to a billing country + currency. */
function geoFromLocale(locale: string): { country: string; currency: string } {
  return locale.toLowerCase().startsWith('ru')
    ? { country: 'RU', currency: 'RUB' }
    : { country: 'US', currency: 'USD' };
}

/** Region selector ⇄ provider override (design §19). */
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
 * User-scoped billing self-service (design §11, §19). Every read and mutation is
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
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly billing: BillingService,
    private readonly usageRating: UsageRating,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2
  ) {}

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

  async getDefaultPaymentMethod(userId: string): Promise<PaymentMethod | null> {
    const customer = await this.customers.findOne({ where: { userId } });
    if (!customer?.defaultPaymentMethodId) return null;
    return this.paymentMethods.findOne({
      where: { id: customer.defaultPaymentMethodId, customerId: customer.id }
    });
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

    // No in-place cross-provider migration (design §19): if a live subscription
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

  private checkoutUrl(outcome: 'success' | 'cancel'): string {
    const base =
      this.config.get<string>('CLIENT_URL') ?? 'http://localhost:4200';
    return `${base.replace(/\/$/, '')}/billing/checkout/${outcome}`;
  }
}
