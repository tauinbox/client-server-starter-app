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
import { SUBSCRIPTION_LIST_QUERY } from '@app/shared/constants';
import { NotifyService } from '@core/services/notify.service';
import { withList } from '@shared/store/with-list';
import type { CancelMode } from '@features/billing/services/billing.service';
import { BillingAdminService } from '../services/billing-admin.service';

/**
 * One list, one store, one entity collection - the shape every list page in
 * this project follows. The admin billing console holds two lists, so it
 * provides this store next to `BillingInvoicesStore` rather than folding both
 * collections into one.
 */
export const BillingSubscriptionsStore = signalStore(
  withState({ working: false }),
  withList({
    spec: SUBSCRIPTION_LIST_QUERY,
    urlKey: 'subs',
    fallbackKey: 'admin.billing.errorLoadFailed',
    fetcher: () => {
      const billing = inject(BillingAdminService);
      return (request) => billing.listSubscriptions(request);
    }
  }),
  withComputed((store) => ({
    subscriptions: computed(() => store.entities())
  })),
  withMethods((store) => {
    const billing = inject(BillingAdminService);
    const notify = inject(NotifyService);

    return {
      async cancelSubscription(
        id: string,
        mode: CancelMode = 'period_end'
      ): Promise<boolean> {
        patchState(store, { working: true });
        try {
          const updated = await firstValueFrom(
            billing.cancelSubscription(id, mode)
          );
          patchState(store, updateEntity({ id, changes: updated }));
          notify.success('admin.billing.successCancelled');
          return true;
        } catch (error) {
          notify.error(
            error as HttpErrorResponse,
            'admin.billing.errorCancelFailed'
          );
          return false;
        } finally {
          patchState(store, { working: false });
        }
      }
    };
  })
);
