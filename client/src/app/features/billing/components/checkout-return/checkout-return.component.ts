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
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { BillingStore } from '../../store/billing.store';
import { formatMoney } from '../../utils/billing-format';
import {
  clearPendingPurchase,
  readPendingPurchase,
  type PendingPurchase
} from '../../utils/pending-purchase';

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
  readonly #transloco = inject(TranslocoService);

  protected readonly settingsRoute = `/${AppRouteSegmentEnum.Billing}/${AppRouteSegmentEnum.BillingSettings}`;
  protected readonly pricingRoute = `/${AppRouteSegmentEnum.Billing}`;

  // 'pending' while polling, 'confirmed' once the subscription is active (or
  // the one-time invoice is paid), 'unconfirmed' if the webhook never landed
  // within the poll window.
  protected readonly pollState = signal<
    'pending' | 'confirmed' | 'unconfirmed'
  >('pending');

  // A one-time purchase return: the session ref parked before the provider
  // redirect flips this page from subscription polling to invoice polling.
  protected readonly purchase = signal<PendingPurchase | null>(null);

  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  protected readonly planName = computed(
    () => this.store.currentPlan()?.name ?? ''
  );
  protected readonly periodEnd = computed(
    () => this.store.subscription()?.currentPeriodEnd ?? null
  );

  protected readonly purchaseAmount = computed(() => {
    const pending = this.purchase();
    if (!pending || pending.amountMinor <= 0) return '';
    return formatMoney(pending.amountMinor, pending.currency, this.#lang());
  });

  #timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    if (this.mode() === 'cancel') {
      // An abandoned checkout leaves nothing to confirm.
      clearPendingPurchase();
      return;
    }

    const pending = readPendingPurchase();
    this.purchase.set(pending);
    if (pending) {
      void this.#pollPurchase(pending, 0);
    } else {
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

  /**
   * One-time purchase confirmation: the paid invoice is keyed by the provider
   * payment reference the purchase session returned, so poll the invoice list
   * for it (the webhook may land slightly after the redirect).
   */
  async #pollPurchase(
    pending: PendingPurchase,
    attempt: number
  ): Promise<void> {
    const invoices = await this.store.refreshInvoices();
    const paid = invoices.find(
      (invoice) =>
        invoice.providerInvoiceRef === pending.sessionRef &&
        invoice.status === 'paid'
    );
    if (paid) {
      clearPendingPurchase();
      this.pollState.set('confirmed');
      return;
    }
    if (attempt + 1 >= MAX_POLLS) {
      // Stale refs must not hijack a later subscription checkout's return.
      clearPendingPurchase();
      this.pollState.set('unconfirmed');
      return;
    }
    this.#timer = setTimeout(
      () => void this.#pollPurchase(pending, attempt + 1),
      POLL_INTERVAL_MS
    );
  }
}
