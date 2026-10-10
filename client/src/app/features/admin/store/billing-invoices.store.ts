import { computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import { updateEntity } from '@ngrx/signals/entities';
import type { HttpErrorResponse } from '@angular/common/http';
import { INVOICE_LIST_QUERY } from '@app/shared/constants';
import { NotifyService } from '@core/services/notify.service';
import { withList } from '@shared/store/with-list';
import { BillingAdminService } from '../services/billing-admin.service';

/** Admin-side invoice list; see `BillingSubscriptionsStore` for the pattern. */
export const BillingInvoicesStore = signalStore(
  withState({ working: false }),
  withList({
    spec: INVOICE_LIST_QUERY,
    urlKey: 'invoices',
    fallbackKey: 'admin.billing.errorLoadFailed',
    fetcher: () => {
      const billing = inject(BillingAdminService);
      return (request) => billing.listInvoices(request);
    }
  }),
  withComputed((store) => ({
    invoices: computed(() => store.entities())
  })),
  withMethods((store) => {
    const billing = inject(BillingAdminService);
    const notify = inject(NotifyService);

    return {
      async refundInvoice(id: string, amountMinor?: number): Promise<boolean> {
        patchState(store, { working: true });
        try {
          const updated = await firstValueFrom(
            billing.refundInvoice(id, amountMinor)
          );
          patchState(store, updateEntity({ id, changes: updated }));
          notify.success('admin.billing.successRefunded');
          return true;
        } catch (error) {
          notify.error(
            error as HttpErrorResponse,
            'admin.billing.errorRefundFailed'
          );
          return false;
        } finally {
          patchState(store, { working: false });
        }
      }
    };
  })
);
