import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, merge } from 'rxjs';
import { BILLING_FLAG_KEY } from '@app/shared/constants';
import { NotificationsService } from '@core/services/notifications.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { UserNotificationsService } from './user-notifications.service';

/**
 * The unread count of the header bell. It reloads when a notice arrives on
 * the stream and when the stream comes back after a gap, because the server
 * keeps no event history.
 */
@Injectable({ providedIn: 'root' })
export class UnreadNoticesService {
  readonly #api = inject(UserNotificationsService);
  readonly #auth = inject(AuthStore);
  readonly #billingEnabled =
    inject(FeatureFlagsStore).isEnabled(BILLING_FLAG_KEY);

  readonly #unread = signal(0);

  // Bumped on each fetch, so an older answer cannot replace a newer one.
  #fetchSeq = 0;

  readonly unread = this.#unread.asReadonly();

  /** Every notice kind is a billing notice, so no billing means no bell. */
  readonly available = computed(
    () => this.#auth.isAuthenticated() && this.#billingEnabled()
  );

  constructor() {
    effect(() => {
      if (this.available()) {
        untracked(() => void this.refresh());
      } else {
        this.#fetchSeq++;
        this.#unread.set(0);
      }
    });

    const stream = inject(NotificationsService);

    merge(stream.notificationCreated$, stream.reconnected$)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.available()) void this.refresh();
      });
  }

  async refresh(): Promise<void> {
    const seq = ++this.#fetchSeq;

    try {
      const { unread } = await firstValueFrom(this.#api.unreadCount());

      if (seq === this.#fetchSeq) this.#unread.set(unread);
    } catch {
      // The count is a hint: a failed read keeps the last value, and the
      // next notice or reconnect reads it again.
    }
  }
}
