import { computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import { updateEntity, withEntities } from '@ngrx/signals/entities';
import type { HttpErrorResponse } from '@angular/common/http';
import type { InvoiceResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import { withCursorList } from '@shared/store/with-cursor-list';
import { BillingAdminService } from '../services/billing-admin.service';

/** Admin-side invoice list; see `BillingSubscriptionsStore` for the pattern. */
export const BillingInvoicesStore = signalStore(
  withEntities<InvoiceResponse>(),
  withState({ working: false }),
  withCursorList<InvoiceResponse>({
    fallbackKey: 'admin.billing.errors.loadFailed'
  }),
  withComputed((store) => ({
    invoices: computed(() => store.entities())
  })),
  withMethods((store) => {
    const billing = inject(BillingAdminService);
    const notify = inject(NotifyService);

    return {
      load(): void {
        void store.loadFirstPage((request) => billing.listInvoices(request));
      },

      loadMore(): void {
        void store.loadNextPage((request) => billing.listInvoices(request));
      },

      async refundInvoice(id: string, amountMinor?: number): Promise<boolean> {
        patchState(store, { working: true });
        try {
          const updated = await firstValueFrom(
            billing.refundInvoice(id, amountMinor)
          );
          patchState(store, updateEntity({ id, changes: updated }));
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
    };
  })
);
