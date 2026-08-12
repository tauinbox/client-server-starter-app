import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import type {
  BillingRegion,
  BillingRegionResponse,
  CheckoutSessionResponse,
  CreditBalanceResponse,
  InvoiceResponse,
  PaymentMethodResponse,
  PlanResponse,
  ProductResponse,
  PurchaseSessionResponse,
  SubscriptionResponse,
  UsageSummaryResponse
} from '@app/shared/types';
import { DEFAULT_PAGE_SIZE } from '@app/shared/constants/pagination.constants';
import { NotifyService } from '@core/services/notify.service';
import {
  BillingService,
  type CancelMode,
  type PurchaseRequest
} from '../services/billing.service';

/** Zero-based index to match `mat-paginator`; the API pages are 1-based. */
type InvoicesPage = {
  pageIndex: number;
  pageSize: number;
  total: number;
};

type BillingState = {
  plans: PlanResponse[];
  products: ProductResponse[];
  subscription: SubscriptionResponse | null;
  invoices: InvoiceResponse[];
  invoicesPage: InvoicesPage;
  paymentMethod: PaymentMethodResponse | null;
  usage: UsageSummaryResponse | null;
  credits: CreditBalanceResponse | null;
  region: BillingRegionResponse | null;
  loading: boolean;
  working: boolean;
};

const initialInvoicesPage: InvoicesPage = {
  pageIndex: 0,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0
};

const initialState: BillingState = {
  plans: [],
  products: [],
  subscription: null,
  invoices: [],
  invoicesPage: initialInvoicesPage,
  paymentMethod: null,
  usage: null,
  credits: null,
  region: null,
  loading: false,
  working: false
};

// Statuses that grant access — used to decide which plan is "current" and to
// drive the active/empty UI states. Mirrors the server's open-subscription set.
const ACTIVE_STATUSES: readonly SubscriptionResponse['status'][] = [
  'trialing',
  'active',
  'past_due'
];

export const BillingStore = signalStore(
  withState(initialState),
  withComputed((store) => ({
    /** The plan the caller is currently subscribed to, if any. */
    currentPlan: computed(() => {
      const sub = store.subscription();
      if (!sub) return null;
      return store.plans().find((p) => p.key === sub.planKey) ?? null;
    }),
    hasActiveSubscription: computed(() => {
      const sub = store.subscription();
      return sub !== null && ACTIVE_STATUSES.includes(sub.status);
    })
  })),
  withMethods((store) => {
    const billing = inject(BillingService);
    const notify = inject(NotifyService);

    async function loadPlans(): Promise<void> {
      try {
        const plans = await firstValueFrom(billing.getPlans());
        patchState(store, { plans });
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.loadFailed');
      }
    }

    async function loadRegion(): Promise<void> {
      try {
        const region = await firstValueFrom(billing.getRegion());
        patchState(store, { region });
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.loadFailed');
      }
    }

    async function loadProducts(): Promise<void> {
      try {
        const products = await firstValueFrom(billing.getProducts());
        patchState(store, { products });
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.loadFailed');
      }
    }

    /**
     * Pricing page: plans always; region, current subscription and the
     * one-time catalog only when authenticated (those endpoints require auth;
     * the subscription drives the "Current" badge on the matching tier).
     */
    async function loadPricing(authenticated: boolean): Promise<void> {
      patchState(store, { loading: true });
      await Promise.all([
        loadPlans(),
        authenticated ? loadRegion() : Promise.resolve(),
        authenticated ? refreshSubscription() : Promise.resolve(),
        authenticated ? loadProducts() : Promise.resolve()
      ]);
      patchState(store, { loading: false });
    }

    /**
     * Settings page: subscription + invoices + payment method + usage +
     * credits + plans + region. Requests settle independently so a single
     * failure keeps the slices that did load; the first failure is reported
     * once.
     */
    function pageRequest({ pageIndex, pageSize }: InvoicesPage) {
      return { page: pageIndex + 1, limit: pageSize };
    }

    async function loadSettings(): Promise<void> {
      patchState(store, { loading: true });
      // Opening the page always starts at the first page of invoices.
      const invoicesPage = { ...store.invoicesPage(), pageIndex: 0 };
      const results = await Promise.allSettled([
        firstValueFrom(billing.getSubscription()),
        firstValueFrom(billing.getInvoices(pageRequest(invoicesPage))),
        firstValueFrom(billing.getPaymentMethod()),
        firstValueFrom(billing.getUsage()),
        firstValueFrom(billing.getCredits()),
        firstValueFrom(billing.getPlans()),
        firstValueFrom(billing.getRegion())
      ]);
      const [
        subscription,
        invoices,
        paymentMethod,
        usage,
        credits,
        plans,
        region
      ] = results;
      const patch: Partial<BillingState> = { loading: false };
      if (subscription.status === 'fulfilled')
        patch.subscription = subscription.value;
      if (invoices.status === 'fulfilled') {
        patch.invoices = invoices.value.data;
        patch.invoicesPage = {
          ...invoicesPage,
          total: invoices.value.meta.total
        };
      }
      if (paymentMethod.status === 'fulfilled')
        patch.paymentMethod = paymentMethod.value;
      if (usage.status === 'fulfilled') patch.usage = usage.value;
      if (credits.status === 'fulfilled') patch.credits = credits.value;
      if (plans.status === 'fulfilled') patch.plans = plans.value;
      if (region.status === 'fulfilled') patch.region = region.value;
      patchState(store, patch);
      const failed = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      );
      if (failed) {
        notify.error(
          failed.reason as HttpErrorResponse,
          'billing.errors.loadFailed'
        );
      }
    }

    /** Refresh just the subscription (e.g. after a checkout return). */
    async function refreshSubscription(): Promise<SubscriptionResponse | null> {
      try {
        const subscription = await firstValueFrom(billing.getSubscription());
        patchState(store, { subscription });
        return subscription;
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.loadFailed');
        return store.subscription();
      }
    }

    /**
     * Start a checkout for a plan and return the provider session (the caller
     * performs the redirect). Returns `null` on failure (error is surfaced).
     */
    async function checkout(
      planKey: string
    ): Promise<CheckoutSessionResponse | null> {
      patchState(store, { working: true });
      try {
        return await firstValueFrom(billing.checkout(planKey));
      } catch (error) {
        notify.error(
          error as HttpErrorResponse,
          'billing.errors.checkoutFailed'
        );
        return null;
      } finally {
        patchState(store, { working: false });
      }
    }

    /**
     * Start a one-time purchase and return the provider session (the caller
     * persists the pending ref and performs the redirect). `null` on failure.
     */
    async function purchase(
      request: PurchaseRequest
    ): Promise<PurchaseSessionResponse | null> {
      patchState(store, { working: true });
      try {
        return await firstValueFrom(billing.purchase(request));
      } catch (error) {
        notify.error(
          error as HttpErrorResponse,
          'billing.errors.purchaseFailed'
        );
        return null;
      } finally {
        patchState(store, { working: false });
      }
    }

    /**
     * Refresh just the invoices (e.g. while a one-time purchase return waits
     * for the provider webhook to settle the paid invoice).
     */
    async function refreshInvoices(): Promise<InvoiceResponse[]> {
      const invoicesPage = store.invoicesPage();
      try {
        const result = await firstValueFrom(
          billing.getInvoices(pageRequest(invoicesPage))
        );
        patchState(store, {
          invoices: result.data,
          invoicesPage: { ...invoicesPage, total: result.meta.total }
        });
        return result.data;
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.loadFailed');
        return store.invoices();
      }
    }

    /** Moves the invoice history to another page (paginator interaction). */
    async function loadInvoicesPage(
      pageIndex: number,
      pageSize: number
    ): Promise<void> {
      const invoicesPage = {
        pageIndex,
        pageSize,
        total: store.invoicesPage().total
      };
      try {
        const result = await firstValueFrom(
          billing.getInvoices(pageRequest(invoicesPage))
        );
        patchState(store, {
          invoices: result.data,
          invoicesPage: { ...invoicesPage, total: result.meta.total }
        });
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.loadFailed');
      }
    }

    /**
     * Instantly switch the subscription to another plan (prorated server-side),
     * then quietly refresh the artifacts the switch produces: the proration
     * receipt rows in the invoice history and the usage summary (the billing
     * mode may have changed).
     */
    async function changePlan(planKey: string): Promise<boolean> {
      patchState(store, { working: true });
      try {
        const subscription = await firstValueFrom(billing.changePlan(planKey));
        patchState(store, { subscription });
        notify.success('billing.changePlan.success');
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.changeFailed');
        return false;
      } finally {
        patchState(store, { working: false });
      }
      const invoicesPage = { ...store.invoicesPage(), pageIndex: 0 };
      try {
        const [invoices, usage] = await Promise.all([
          firstValueFrom(billing.getInvoices(pageRequest(invoicesPage))),
          firstValueFrom(billing.getUsage())
        ]);
        patchState(store, {
          invoices: invoices.data,
          invoicesPage: { ...invoicesPage, total: invoices.meta.total },
          usage
        });
      } catch {
        // The switch itself succeeded and was reported; a stale invoice list
        // self-heals on the next settings load.
      }
      return true;
    }

    /**
     * Start the provider-hosted payment-method update flow and return the
     * session (the caller performs the redirect). `null` on failure.
     */
    async function startPaymentMethodUpdate(): Promise<CheckoutSessionResponse | null> {
      patchState(store, { working: true });
      try {
        return await firstValueFrom(billing.updatePaymentMethod());
      } catch (error) {
        notify.error(
          error as HttpErrorResponse,
          'billing.errors.paymentMethodFailed'
        );
        return null;
      } finally {
        patchState(store, { working: false });
      }
    }

    async function cancel(mode: CancelMode = 'period_end'): Promise<boolean> {
      patchState(store, { working: true });
      try {
        const subscription = await firstValueFrom(billing.cancel(mode));
        patchState(store, { subscription });
        notify.success('billing.settings.cancelSuccess');
        return true;
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.cancelFailed');
        return false;
      } finally {
        patchState(store, { working: false });
      }
    }

    async function setRegion(region: BillingRegion): Promise<boolean> {
      patchState(store, { working: true });
      try {
        const updated = await firstValueFrom(billing.setRegion(region));
        patchState(store, { region: updated });
        return true;
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.regionFailed');
        return false;
      } finally {
        patchState(store, { working: false });
      }
    }

    return {
      loadPlans,
      loadRegion,
      loadProducts,
      loadPricing,
      loadSettings,
      refreshSubscription,
      refreshInvoices,
      loadInvoicesPage,
      checkout,
      purchase,
      changePlan,
      startPaymentMethodUpdate,
      cancel,
      setRegion
    };
  })
);
