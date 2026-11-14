import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { patchState, signalStore, withMethods } from '@ngrx/signals';
import { updateEntity } from '@ngrx/signals/entities';
import type { HttpErrorResponse } from '@angular/common/http';
import { USER_NOTIFICATION_LIST_QUERY } from '@app/shared/constants';
import { NotifyService } from '@core/services/notify.service';
import { withList } from '@shared/store/with-list';
import { UserNotificationsService } from '../services/user-notifications.service';
import { UnreadNoticesService } from '../services/unread-notices.service';

/** The stored notices of the signed-in user, newest first. */
export const UserNotificationsStore = signalStore(
  withList({
    spec: USER_NOTIFICATION_LIST_QUERY,
    urlKey: 'notices',
    fallbackKey: 'billing.notifications.store.errorLoadFailed',
    fetcher: () => {
      const api = inject(UserNotificationsService);

      return (request) => api.list(request);
    }
  }),
  withMethods((store) => {
    const api = inject(UserNotificationsService);
    const unread = inject(UnreadNoticesService);
    const notify = inject(NotifyService);

    return {
      async markRead(id: string): Promise<void> {
        try {
          await firstValueFrom(api.markRead(id));
          patchState(
            store,
            updateEntity({
              id,
              changes: { readAt: new Date().toISOString() }
            })
          );
          void unread.refresh();
        } catch (error) {
          notify.error(
            error as HttpErrorResponse,
            'billing.notifications.store.errorMarkReadFailed'
          );
        }
      }
    };
  })
);
