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
  InvoiceResponse,
  PaymentMethodResponse,
  PlanResponse,
  SubscriptionResponse
} from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import { BillingService, type CancelMode } from '../services/billing.service';

type BillingState = {
  plans: PlanResponse[];
  subscription: SubscriptionResponse | null;
  invoices: InvoiceResponse[];
  paymentMethod: PaymentMethodResponse | null;
  region: BillingRegionResponse | null;
  loading: boolean;
  working: boolean;
};

const initialState: BillingState = {
  plans: [],
  subscription: null,
  invoices: [],
  paymentMethod: null,
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

    /**
     * Pricing page: plans always; region + current subscription only when
     * authenticated (both endpoints require auth, and the subscription drives
     * the "Current" badge on the matching tier).
     */
    async function loadPricing(authenticated: boolean): Promise<void> {
      patchState(store, { loading: true });
      await Promise.all([
        loadPlans(),
        authenticated ? loadRegion() : Promise.resolve(),
        authenticated ? refreshSubscription() : Promise.resolve()
      ]);
      patchState(store, { loading: false });
    }

    /** Settings page: subscription + invoices + payment method + plans + region. */
    async function loadSettings(): Promise<void> {
      patchState(store, { loading: true });
      try {
        const [subscription, invoices, paymentMethod, plans, region] =
          await Promise.all([
            firstValueFrom(billing.getSubscription()),
            firstValueFrom(billing.getInvoices()),
            firstValueFrom(billing.getPaymentMethod()),
            firstValueFrom(billing.getPlans()),
            firstValueFrom(billing.getRegion())
          ]);
        patchState(store, {
          subscription,
          invoices,
          paymentMethod,
          plans,
          region
        });
      } catch (error) {
        notify.error(error as HttpErrorResponse, 'billing.errors.loadFailed');
      } finally {
        patchState(store, { loading: false });
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
      loadPricing,
      loadSettings,
      refreshSubscription,
      checkout,
      cancel,
      setRegion
    };
  })
);
