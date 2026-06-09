import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslocoDirective } from '@jsverse/transloco';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { BillingStore } from '../../store/billing.store';

type CheckoutMode = 'success' | 'cancel';

// The provider webhook is the source of truth and may land slightly after the
// browser returns from checkout — poll the subscription a few times before
// giving up and pointing the user at settings.
const MAX_POLLS = 5;
const POLL_INTERVAL_MS = 1500;

@Component({
  selector: 'nxs-checkout-return',
  imports: [
    DatePipe,
    RouterLink,
    MatCard,
    MatCardContent,
    MatButton,
    MatIcon,
    MatProgressSpinner,
    TranslocoDirective
  ],
  templateUrl: './checkout-return.component.html',
  styleUrl: './checkout-return.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CheckoutReturnComponent implements OnInit {
  readonly mode = input<CheckoutMode>('success');

  protected readonly store = inject(BillingStore);
  readonly #destroyRef = inject(DestroyRef);

  protected readonly settingsRoute = `/${AppRouteSegmentEnum.Billing}/${AppRouteSegmentEnum.BillingSettings}`;
  protected readonly pricingRoute = `/${AppRouteSegmentEnum.Billing}`;

  // 'pending' while polling, 'confirmed' once the subscription is active,
  // 'unconfirmed' if it never activated within the poll window.
  protected readonly pollState = signal<
    'pending' | 'confirmed' | 'unconfirmed'
  >('pending');

  protected readonly planName = computed(
    () => this.store.currentPlan()?.name ?? ''
  );
  protected readonly periodEnd = computed(
    () => this.store.subscription()?.currentPeriodEnd ?? null
  );

  #timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    if (this.mode() === 'success') {
      // Plans may be unloaded on a fresh return from the provider — needed to
      // resolve the subscribed plan's display name.
      if (this.store.plans().length === 0) {
        void this.store.loadPlans();
      }
      void this.#poll(0);
    }
    this.#destroyRef.onDestroy(() => {
      if (this.#timer) clearTimeout(this.#timer);
    });
  }

  async #poll(attempt: number): Promise<void> {
    await this.store.refreshSubscription();
    if (this.store.hasActiveSubscription()) {
      this.pollState.set('confirmed');
      return;
    }
    if (attempt + 1 >= MAX_POLLS) {
      this.pollState.set('unconfirmed');
      return;
    }
    this.#timer = setTimeout(
      () => void this.#poll(attempt + 1),
      POLL_INTERVAL_MS
    );
  }
}
