import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButton } from '@angular/material/button';
import {
  MatButtonToggle,
  MatButtonToggleGroup
} from '@angular/material/button-toggle';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import { FREE_PLAN_KEY } from '@app/shared/constants';
import type {
  BillingMode,
  PlanResponse,
  ProductResponse
} from '@app/shared/types';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
import { AuthStore } from '@features/auth/store/auth.store';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { CheckoutRedirectService } from '../../services/checkout-redirect.service';
import { PADDLE_TRANSACTION_PARAM } from '../../services/paddle-checkout.service';
import { SubscriptionCancelService } from '../../services/subscription-cancel.service';
import { BillingStore } from '../../store/billing.store';
import { catalogText } from '../../utils/catalog-text';
import {
  formatMoney,
  planPriceFor,
  productPriceFor,
  resolveDisplayProvider
} from '../../utils/billing-format';
import {
  storePendingPurchase,
  type PendingPurchase
} from '../../utils/pending-purchase';
import { PlanCardComponent } from '../plan-card/plan-card.component';
import { RegionControlComponent } from '../region-control/region-control.component';
import { ProductCardComponent } from '../product-card/product-card.component';
import {
  DonationCardComponent,
  type DonationSubmit
} from '../donation-card/donation-card.component';

type PricedPlan = {
  readonly key: string;
  readonly featured: boolean;
  readonly current: boolean;
  readonly price: string;
  readonly actionKey: string;
  readonly plan: PlanResponse;
};

type PricedProduct = {
  readonly key: string;
  readonly price: string;
  readonly product: ProductResponse;
};

@Component({
  selector: 'nxs-pricing-page',
  imports: [
    RouterLink,
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatProgressSpinner,
    LocalizedDatePipe,
    MatIcon,
    TranslocoDirective,
    PlanCardComponent,
    RegionControlComponent,
    ProductCardComponent,
    DonationCardComponent
  ],
  templateUrl: './pricing-page.component.html',
  styleUrl: './pricing-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PricingPageComponent implements OnInit {
  protected readonly store = inject(BillingStore);
  readonly #authStore = inject(AuthStore);
  readonly #router = inject(Router);
  readonly #transloco = inject(TranslocoService);
  readonly #checkoutRedirect = inject(CheckoutRedirectService);
  readonly #cancelService = inject(SubscriptionCancelService);

  protected readonly isAuthenticated = this.#authStore.isAuthenticated;
  protected readonly settingsRoute = `/${AppRouteSegmentEnum.Billing}/${AppRouteSegmentEnum.BillingSettings}`;

  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  protected readonly displayProvider = computed(() =>
    resolveDisplayProvider(
      this.store.region()?.effectiveProvider ?? null,
      this.#lang()
    )
  );

  // No region (anonymous, or not loaded) keeps the actions enabled; an
  // anonymous "Choose" goes to login first.
  protected readonly paymentsAvailable = computed(() => {
    const region = this.store.region();

    return (
      !region || region.availableProviders.includes(region.effectiveProvider)
    );
  });

  protected readonly actionsDisabled = computed(
    () => this.store.working() || !this.paymentsAvailable()
  );

  // The plan that grants the caller access now. Free is the implicit default
  // for an authenticated user whose subscription grants nothing, for example
  // an unpaid `incomplete` checkout.
  protected readonly currentPlanKey = computed(() => {
    if (!this.isAuthenticated()) return null;

    const sub = this.store.subscription();

    if (sub && this.store.hasActiveSubscription()) return sub.planKey;

    return FREE_PLAN_KEY;
  });

  /**
   * The paid mode on show: the mode of the entitled subscription, else the
   * subscription tiers. The toggle overrides it until the subscription changes.
   */
  protected readonly paidMode = linkedSignal<BillingMode>(() => {
    const sub = this.store.subscription();

    return sub && this.store.hasActiveSubscription()
      ? sub.billingMode
      : 'fixed';
  });

  readonly #paidPlans = computed(() =>
    this.store.plans().filter((plan) => plan.key !== FREE_PLAN_KEY)
  );

  /** The toggle shows only when the catalog offers both paid modes. */
  protected readonly showModeToggle = computed(() => {
    const modes = new Set(this.#paidPlans().map((plan) => plan.billingMode));

    return modes.has('fixed') && modes.has('usage');
  });

  protected readonly freeCard = computed<PricedPlan | null>(() => {
    const plan = this.store.plans().find((p) => p.key === FREE_PLAN_KEY);

    if (!plan) return null;

    return {
      ...this.#priced(plan),
      actionKey: this.store.hasActiveSubscription()
        ? 'billing.pricing.switchToFree'
        : 'billing.pricing.choose'
    };
  });

  /** The day a scheduled cancel returns the caller to Free, or null. */
  protected readonly freeFrom = computed(() => {
    const sub = this.store.subscription();

    return sub && this.store.hasActiveSubscription() && sub.cancelAtPeriodEnd
      ? sub.currentPeriodEnd
      : null;
  });

  protected readonly paidCards = computed<PricedPlan[]>(() =>
    this.#paidPlans()
      .filter((plan) => plan.billingMode === this.paidMode())
      .map((plan) => this.#priced(plan))
  );

  #priced(plan: PlanResponse): PricedPlan {
    const price = planPriceFor(plan, this.displayProvider());
    // A usage plan has no flat fee: the card shows the price of one unit.
    const amountMinor =
      plan.billingMode === 'usage'
        ? (price?.unitPriceMinor ?? 0)
        : (price?.amountMinor ?? 0);

    return {
      key: plan.key,
      plan,
      featured: plan.key === 'pro',
      current: plan.key === this.currentPlanKey(),
      price: price
        ? formatMoney(amountMinor, price.currency, this.#lang())
        : '',
      actionKey: this.store.hasActiveSubscription()
        ? 'billing.settings.changePlan'
        : 'billing.pricing.choose'
    };
  }

  setPaidMode(mode: BillingMode): void {
    this.paidMode.set(mode);
  }

  // One-time purchases: fixed-price products as cards, custom
  // products as donation forms. The catalog endpoint requires auth, so the
  // section exists only for authenticated callers with a non-empty catalog.
  protected readonly oneTimeProducts = computed<PricedProduct[]>(() => {
    const provider = this.displayProvider();
    const lang = this.#lang();

    return this.store
      .products()
      .filter((product) => product.type !== 'custom')
      .map((product) => {
        const price = productPriceFor(product, provider);

        return {
          key: product.key,
          product,
          price: price?.amountMinor
            ? formatMoney(price.amountMinor, price.currency, lang)
            : ''
        };
      });
  });

  protected readonly donationProducts = computed(() =>
    this.store.products().filter((product) => product.type === 'custom')
  );

  protected readonly showOneTime = computed(
    () => this.isAuthenticated() && this.store.products().length > 0
  );

  ngOnInit(): void {
    void this.store.loadPricing(this.isAuthenticated());
  }

  onChoose(planKey: string): void {
    if (!this.isAuthenticated()) {
      void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`], {
        queryParams: { returnUrl: `/${AppRouteSegmentEnum.Billing}` }
      });

      return;
    }

    // Free is the absence of a subscription: a subscriber returns to it
    // through a cancel at the end of the period.
    if (planKey === FREE_PLAN_KEY) {
      if (this.store.hasActiveSubscription()) {
        void this.#cancelService.confirmAndCancel();
      }

      return;
    }

    // The server refuses a second checkout while a subscription is entitled;
    // the plan change lives on the settings page.
    if (this.store.hasActiveSubscription()) {
      void this.#router.navigateByUrl(this.settingsRoute);

      return;
    }

    void this.store.checkout(planKey).then((session) => {
      if (session) {
        this.#checkoutRedirect.redirect(session.url);
      }
    });
  }

  onBuy(item: PricedProduct): void {
    const price = productPriceFor(item.product, this.displayProvider());

    void this.#purchase(
      { productKey: item.product.key },
      {
        productName: catalogText(this.#transloco, {
          kind: 'products',
          item: item.product,
          field: 'name'
        }),
        amountMinor: price?.amountMinor ?? 0,
        currency: price?.currency ?? 'USD'
      }
    );
  }

  onDonate(product: ProductResponse, submit: DonationSubmit): void {
    const price = productPriceFor(product, this.displayProvider());

    void this.#purchase(
      {
        productKey: product.key,
        amountMinor: submit.amountMinor,
        description: submit.note
      },
      {
        productName: catalogText(this.#transloco, {
          kind: 'products',
          item: product,
          field: 'name'
        }),
        amountMinor: submit.amountMinor,
        currency: price?.currency ?? 'USD'
      }
    );
  }

  /**
   * Start the one-time purchase, park the session reference for the return
   * page, then follow the provider: redirect when it hands back a hosted
   * checkout URL, or else open the return page, which opens the Paddle.js
   * checkout of the transaction and then waits for the webhook.
   */
  async #purchase(
    request: { productKey: string; amountMinor?: number; description?: string },
    pending: Omit<PendingPurchase, 'sessionRef'>
  ): Promise<void> {
    const session = await this.store.purchase(request);

    if (!session) return;

    storePendingPurchase({ ...pending, sessionRef: session.sessionRef });

    if (session.url) {
      this.#checkoutRedirect.redirect(session.url);

      return;
    }

    void this.#router.navigate(
      [`/${AppRouteSegmentEnum.Billing}/${AppRouteSegmentEnum.BillingSuccess}`],
      session.provider === 'paddle'
        ? { queryParams: { [PADDLE_TRANSACTION_PARAM]: session.sessionRef } }
        : {}
    );
  }
}
