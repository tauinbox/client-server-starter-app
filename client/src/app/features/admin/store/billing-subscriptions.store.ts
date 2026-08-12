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
import type { SubscriptionResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import { withCursorList } from '@shared/store/with-cursor-list';
import type { CancelMode } from '@features/billing/services/billing.service';
import { BillingAdminService } from '../services/billing-admin.service';

/**
 * One list, one store, one entity collection - the shape every list page in
 * this project follows. The admin billing console holds two lists, so it
 * provides this store next to `BillingInvoicesStore` rather than folding both
 * collections into one.
 */
export const BillingSubscriptionsStore = signalStore(
  withEntities<SubscriptionResponse>(),
  withState({ working: false }),
  withCursorList<SubscriptionResponse>({
    errorKey: 'admin.billing.errors.loadFailed'
  }),
  withComputed((store) => ({
    subscriptions: computed(() => store.entities())
  })),
  withMethods((store) => {
    const billing = inject(BillingAdminService);
    const notify = inject(NotifyService);

    return {
      load(): void {
        void store.loadFirstPage((request) =>
          billing.listSubscriptions(request)
        );
      },

      loadMore(): void {
        void store.loadNextPage((request) =>
          billing.listSubscriptions(request)
        );
      },

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
    };
  })
);
