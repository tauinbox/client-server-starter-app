import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslocoDirective } from '@jsverse/transloco';
import type {
  UserNotificationKind,
  UserNotificationResponse
} from '@app/shared/types';
import { formatUtcDay } from '@app/shared/utils/intl-format';
import { NotificationsService } from '@core/services/notifications.service';
import { LanguageService } from '@core/services/language.service';
import { InfiniteScrollDirective } from '@shared/directives/infinite-scroll.directive';
import { bindListToUrl } from '@shared/store/bind-list-to-url';
import {
  ListSkeletonComponent,
  type ListSkeletonCell
} from '@shared/components/list-skeleton/list-skeleton.component';
import { ListEmptyComponent } from '@shared/components/list-empty/list-empty.component';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
import { UserNotificationsStore } from '../../store/user-notifications.store';
import { formatMoney } from '../../utils/billing-format';

const KIND_ICONS: Record<UserNotificationKind, string> = {
  invoice_paid: 'receipt_long',
  payment_failed: 'error',
  subscription_cancel_scheduled: 'event_busy',
  subscription_canceled: 'cancel',
  renewal_upcoming: 'event_repeat',
  refund_issued: 'undo',
  credit_balance_depleted: 'savings'
};

/** A notice as the page shows it: the key of its text and the values in it. */
type NoticeRow = {
  notice: UserNotificationResponse;
  icon: string;
  textKey: string;
  params: Record<string, string>;
};

@Component({
  selector: 'nxs-notifications-page',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatIconButton,
    MatIcon,
    MatProgressSpinner,
    MatTooltip,
    TranslocoDirective,
    InfiniteScrollDirective,
    ListSkeletonComponent,
    ListEmptyComponent,
    LocalizedDatePipe
  ],
  providers: [UserNotificationsStore],
  templateUrl: './notifications-page.component.html',
  styleUrl: './notifications-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationsPageComponent {
  readonly #store = inject(UserNotificationsStore);
  readonly #language = inject(LanguageService).language;

  readonly loading = this.#store.loading;
  readonly hasMore = this.#store.hasMore;
  readonly isLoadingMore = this.#store.isLoadingMore;
  readonly busy = computed(
    () => this.#store.loading() || this.#store.isLoadingMore()
  );

  readonly skeletonCells: readonly ListSkeletonCell[] = [
    'narrow',
    'wide',
    'medium',
    'actions'
  ];

  readonly rows = computed(() => {
    const lang = this.#language();

    return this.#store.entities().map((notice) => toRow(notice, lang));
  });

  constructor() {
    bindListToUrl(this.#store);

    const stream = inject(NotificationsService);

    // A new notice goes on top, and a gap in the stream may have hidden one.
    merge(stream.notificationCreated$, stream.reconnected$)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.#store.load());
  }

  loadMore(): void {
    this.#store.loadMore();
  }

  markRead(id: string): void {
    void this.#store.markRead(id);
  }
}

function toRow(notice: UserNotificationResponse, lang: string): NoticeRow {
  const icon = KIND_ICONS[notice.kind];

  switch (notice.kind) {
    case 'invoice_paid':
    case 'refund_issued': {
      const { amountMinor, currency } = notice.payload;

      return {
        notice,
        icon,
        textKey: notice.kind,
        params: { amount: formatMoney(amountMinor, currency, lang) }
      };
    }
    case 'payment_failed': {
      const { planName, subscriptionStatus, nextAttemptAt } = notice.payload;

      if (!planName || subscriptionStatus === 'incomplete') {
        return { notice, icon, textKey: 'payment_failed', params: {} };
      }

      if (subscriptionStatus === 'canceled') {
        return {
          notice,
          icon,
          textKey: 'payment_failed_ended',
          params: { plan: planName }
        };
      }

      return nextAttemptAt
        ? {
            notice,
            icon,
            textKey: 'payment_failed_retry',
            params: { plan: planName, date: formatUtcDay(nextAttemptAt, lang) }
          }
        : {
            notice,
            icon,
            textKey: 'payment_failed_provider',
            params: { plan: planName }
          };
    }
    case 'subscription_cancel_scheduled': {
      const { planName, accessEndsAt } = notice.payload;

      return {
        notice,
        icon,
        textKey: notice.kind,
        params: { plan: planName, date: formatUtcDay(accessEndsAt, lang) }
      };
    }
    case 'renewal_upcoming': {
      const { planName, renewsAt, amountMinor, currency } = notice.payload;

      return {
        notice,
        icon,
        textKey: notice.kind,
        params: {
          plan: planName,
          date: formatUtcDay(renewsAt, lang),
          amount: formatMoney(amountMinor, currency, lang)
        }
      };
    }
    case 'subscription_canceled':
      return {
        notice,
        icon,
        textKey: notice.kind,
        params: { plan: notice.payload.planName }
      };
    case 'credit_balance_depleted':
      return { notice, icon, textKey: notice.kind, params: {} };
  }
}
