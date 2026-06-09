import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import type { InvoiceResponse, SubscriptionResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import type { CancelMode } from '@features/billing/services/billing.service';
import { BillingAdminService } from '../services/billing-admin.service';

type BillingAdminState = {
  subscriptions: SubscriptionResponse[];
  invoices: InvoiceResponse[];
  loading: boolean;
  working: boolean;
};

const initialState: BillingAdminState = {
  subscriptions: [],
  invoices: [],
  loading: false,
  working: false
};

export const BillingAdminStore = signalStore(
  withState(initialState),
  withMethods((store) => {
    const billing = inject(BillingAdminService);
    const notify = inject(NotifyService);

    function replaceSubscription(updated: SubscriptionResponse): void {
      patchState(store, {
        subscriptions: store
          .subscriptions()
          .map((s) => (s.id === updated.id ? updated : s))
      });
    }

    function replaceInvoice(updated: InvoiceResponse): void {
      patchState(store, {
        invoices: store
          .invoices()
          .map((i) => (i.id === updated.id ? updated : i))
      });
    }

    async function load(): Promise<void> {
      patchState(store, { loading: true });
      try {
        const [subscriptions, invoices] = await Promise.all([
          firstValueFrom(billing.listSubscriptions()),
          firstValueFrom(billing.listInvoices())
        ]);
        patchState(store, { subscriptions, invoices });
      } catch (error) {
        notify.error(
          error as HttpErrorResponse,
          'admin.billing.errors.loadFailed'
        );
      } finally {
        patchState(store, { loading: false });
      }
    }

    async function cancelSubscription(
      id: string,
      mode: CancelMode = 'period_end'
    ): Promise<boolean> {
      patchState(store, { working: true });
      try {
        const updated = await firstValueFrom(
          billing.cancelSubscription(id, mode)
        );
        replaceSubscription(updated);
        notify.success('admin.billing.cancelSuccess');
        return true;
      } catch (error) {
        notify.error(
          error as HttpErrorResponse,
          'admin.billing.errors.cancelFailed'
        );
        return false;
      } finally {
        patchState(store, { working: false });
      }
    }

    async function refundInvoice(
      id: string,
      amountMinor?: number
    ): Promise<boolean> {
      patchState(store, { working: true });
      try {
        const updated = await firstValueFrom(
          billing.refundInvoice(id, amountMinor)
        );
        replaceInvoice(updated);
        notify.success('admin.billing.refundSuccess');
        return true;
      } catch (error) {
        notify.error(
          error as HttpErrorResponse,
          'admin.billing.errors.refundFailed'
        );
        return false;
      } finally {
        patchState(store, { working: false });
      }
    }

    return { load, cancelSubscription, refundInvoice };
  })
);
