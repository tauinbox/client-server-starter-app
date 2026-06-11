import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  inject
} from '@angular/core';
import { Router } from '@angular/router';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import type {
  BillingRegion,
  PlanResponse,
  ProductResponse
} from '@app/shared/types';
import { AuthStore } from '@features/auth/store/auth.store';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { BillingStore } from '../../store/billing.store';
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
    MatProgressSpinner,
    MatButtonToggleModule,
    MatIcon,
    TranslocoDirective,
    PlanCardComponent,
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
  readonly #window = inject(DOCUMENT).defaultView;

  protected readonly isAuthenticated = this.#authStore.isAuthenticated;

  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  protected readonly displayProvider = computed(() =>
    resolveDisplayProvider(
      this.store.region()?.effectiveProvider ?? null,
      this.#lang()
    )
  );

  // The plan that's currently active for the caller; Free is the implicit
  // default for an authenticated user with no paid subscription.
  protected readonly currentPlanKey = computed(() => {
    if (!this.isAuthenticated()) return null;
    const sub = this.store.subscription();
    if (sub && sub.status !== 'canceled') return sub.planKey;
    return 'free';
  });

  protected readonly pricedPlans = computed<PricedPlan[]>(() => {
    const provider = this.displayProvider();
    const lang = this.#lang();
    const current = this.currentPlanKey();
    return this.store
      .plans()
      .filter((plan) => plan.billingMode === 'fixed')
      .map((plan) => {
        const price = planPriceFor(plan, provider);
        return {
          key: plan.key,
          plan,
          featured: plan.key === 'pro',
          current: plan.key === current,
          price: price
            ? formatMoney(price.amountMinor, price.currency, lang)
            : ''
        };
      });
  });

  // Usage tier teaser (shown while the usage plan is active in the catalog).
  protected readonly usagePlan = computed(
    () =>
      this.store.plans().find((plan) => plan.billingMode === 'usage') ?? null
  );

  protected readonly usagePrice = computed(() => {
    const plan = this.usagePlan();
    if (!plan) return '';
    const price = planPriceFor(plan, this.displayProvider());
    if (!price?.unitPriceMinor) return '';
    return formatMoney(price.unitPriceMinor, price.currency, this.#lang());
  });

  // Region control: shown to authenticated callers once the region is known
  // (the endpoint requires auth). Hidden for anonymous visitors (no override
  // to set).
  protected readonly showRegionControl = computed(
    () => this.isAuthenticated() && this.store.region() !== null
  );

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

  protected readonly regionOptions: readonly BillingRegion[] = [
    'auto',
    'ru',
    'world'
  ];

  ngOnInit(): void {
    void this.store.loadPricing(this.isAuthenticated());
  }

  onRegionChange(region: BillingRegion): void {
    void this.store.setRegion(region);
  }

  onChoose(planKey: string): void {
    if (!this.isAuthenticated()) {
      void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`], {
        queryParams: { returnUrl: `/${AppRouteSegmentEnum.Billing}` }
      });
      return;
    }

    void this.store.checkout(planKey).then((session) => {
      if (session && this.#window) {
        this.#window.location.href = session.url;
      }
    });
  }

  onBuy(item: PricedProduct): void {
    const price = productPriceFor(item.product, this.displayProvider());
    void this.#purchase(
      { productKey: item.product.key },
      {
        productName: item.product.name,
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
        productName: product.name,
        amountMinor: submit.amountMinor,
        currency: price?.currency ?? 'USD'
      }
    );
  }

  /**
   * Start the one-time purchase, park the session reference for the return
   * page, then follow the provider: redirect when it hands back a hosted
   * checkout URL, or go straight to the return page when the payment
   * completes client-side (Paddle.js) and the webhook confirms it.
   */
  async #purchase(
    request: { productKey: string; amountMinor?: number; description?: string },
    pending: Omit<PendingPurchase, 'sessionRef'>
  ): Promise<void> {
    const session = await this.store.purchase(request);
    if (!session) return;
    storePendingPurchase({ ...pending, sessionRef: session.sessionRef });
    if (session.url && this.#window) {
      this.#window.location.href = session.url;
      return;
    }
    void this.#router.navigate([
      `/${AppRouteSegmentEnum.Billing}/${AppRouteSegmentEnum.BillingSuccess}`
    ]);
  }
}
