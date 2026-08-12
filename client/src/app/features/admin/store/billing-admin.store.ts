import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import type { InvoiceResponse, SubscriptionResponse } from '@app/shared/types';
import { DEFAULT_PAGE_SIZE } from '@app/shared/constants/pagination.constants';
import { NotifyService } from '@core/services/notify.service';
import type { CancelMode } from '@features/billing/services/billing.service';
import { BillingAdminService } from '../services/billing-admin.service';

type BillingAdminState = {
  subscriptions: SubscriptionResponse[];
  invoices: InvoiceResponse[];
  subscriptionsPage: PageState;
  invoicesPage: PageState;
  loading: boolean;
  working: boolean;
};

/** Zero-based index to match `mat-paginator`; the API pages are 1-based. */
type PageState = {
  pageIndex: number;
  pageSize: number;
  total: number;
};

const initialPage: PageState = {
  pageIndex: 0,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0
};

const initialState: BillingAdminState = {
  subscriptions: [],
  invoices: [],
  subscriptionsPage: initialPage,
  invoicesPage: initialPage,
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

    function pageRequest({ pageIndex, pageSize }: PageState) {
      return { page: pageIndex + 1, limit: pageSize };
    }

    /**
     * Loads both lists at the page each one currently sits on. Only the rows of
     * that page are fetched — neither list is ever pulled in full.
     */
    async function load(): Promise<void> {
      patchState(store, { loading: true });
      const subscriptionsPage = store.subscriptionsPage();
      const invoicesPage = store.invoicesPage();
      try {
        const [subscriptions, invoices] = await Promise.all([
          firstValueFrom(
            billing.listSubscriptions(pageRequest(subscriptionsPage))
          ),
          firstValueFrom(billing.listInvoices(pageRequest(invoicesPage)))
        ]);
        patchState(store, {
          subscriptions: subscriptions.data,
          invoices: invoices.data,
          subscriptionsPage: {
            ...subscriptionsPage,
            total: subscriptions.meta.total
          },
          invoicesPage: { ...invoicesPage, total: invoices.meta.total }
        });
      } catch (error) {
        notify.error(
          error as HttpErrorResponse,
          'admin.billing.errors.loadFailed'
        );
      } finally {
        patchState(store, { loading: false });
      }
    }

    async function loadSubscriptionsPage(
      pageIndex: number,
      pageSize: number
    ): Promise<void> {
      patchState(store, { loading: true });
      const page = {
        pageIndex,
        pageSize,
        total: store.subscriptionsPage().total
      };
      try {
        const result = await firstValueFrom(
          billing.listSubscriptions(pageRequest(page))
        );
        patchState(store, {
          subscriptions: result.data,
          subscriptionsPage: { ...page, total: result.meta.total }
        });
      } catch (error) {
        notify.error(
          error as HttpErrorResponse,
          'admin.billing.errors.loadFailed'
        );
      } finally {
        patchState(store, { loading: false });
      }
    }

    async function loadInvoicesPage(
      pageIndex: number,
      pageSize: number
    ): Promise<void> {
      patchState(store, { loading: true });
      const page = { pageIndex, pageSize, total: store.invoicesPage().total };
      try {
        const result = await firstValueFrom(
          billing.listInvoices(pageRequest(page))
        );
        patchState(store, {
          invoices: result.data,
          invoicesPage: { ...page, total: result.meta.total }
        });
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

    return {
      load,
      loadSubscriptionsPage,
      loadInvoicesPage,
      cancelSubscription,
      refundInvoice
    };
  })
);
