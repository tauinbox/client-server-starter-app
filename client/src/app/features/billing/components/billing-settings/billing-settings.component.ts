import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject
} from '@angular/core';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { InvoiceResponse } from '@app/shared/types';
import {
  CHANGEABLE_SUBSCRIPTION_STATUSES,
  MAX_CONCURRENT_SESSIONS
} from '@app/shared/constants';
import { LayoutService } from '@core/services/layout.service';
import { NotifyService } from '@core/services/notify.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';
import { InfiniteScrollDirective } from '@shared/directives/infinite-scroll.directive';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { CatalogTextPipe } from '../../pipes/catalog-text.pipe';
import { CheckoutRedirectService } from '../../services/checkout-redirect.service';
import {
  dropPaddleTransactionId,
  PaddleCheckoutService,
  paddleTransactionId
} from '../../services/paddle-checkout.service';
import { BillingStore } from '../../store/billing.store';
import { EntitlementsStore } from '../../store/entitlements.store';
import { formatMoney, planPriceFor } from '../../utils/billing-format';
import type {
  ChangePlanDialogData,
  ChangePlanDialogResult
} from '../change-plan-dialog/change-plan-dialog.component';
import { ChangePlanDialogComponent } from '../change-plan-dialog/change-plan-dialog.component';
import { CreditsCardComponent } from '../credits-card/credits-card.component';
import { RegionControlComponent } from '../region-control/region-control.component';
import { UsageMeterComponent } from '../usage-meter/usage-meter.component';

@Component({
  selector: 'nxs-billing-settings',
  imports: [
    LocalizedDatePipe,
    RouterLink,
    MatCard,
    MatCardContent,
    MatButton,
    MatIcon,
    MatProgressSpinner,
    TranslocoDirective,
    InfiniteScrollDirective,
    CreditsCardComponent,
    RegionControlComponent,
    UsageMeterComponent,
    CatalogTextPipe
  ],
  templateUrl: './billing-settings.component.html',
  styleUrl: './billing-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BillingSettingsComponent implements OnInit {
  protected readonly store = inject(BillingStore);
  readonly #entitlements = inject(EntitlementsStore);
  readonly #layout = inject(LayoutService);
  readonly #dialog = inject(AdaptiveDialogService);
  readonly #matDialog = inject(MatDialog);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #checkoutRedirect = inject(CheckoutRedirectService);
  readonly #paddleCheckout = inject(PaddleCheckoutService);
  readonly #route = inject(ActivatedRoute);
  readonly #router = inject(Router);
  readonly #notify = inject(NotifyService);

  protected readonly billingRoute = `/${AppRouteSegmentEnum.Billing}`;
  protected readonly isHandset = this.#layout.isHandset;

  /** Invoice history state, owned by the shared cursor-list feature. */
  protected readonly invoices = this.store.entities;
  protected readonly invoicesHasMore = this.store.hasMore;
  protected readonly invoicesLoadingMore = this.store.isLoadingMore;
  protected readonly invoicesBusy = computed(
    () => this.store.loading() || this.store.isLoadingMore()
  );

  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  readonly #sessionsLimit = this.#entitlements.limit('sessions');

  /**
   * Read from the resolved-entitlements mirror rather than the plan catalog:
   * the catalog cannot express the Free fallback, and the server applies the
   * same `?? MAX_CONCURRENT_SESSIONS` when the plan carries no limit.
   */
  protected readonly deviceAllowance = computed(
    () => this.#sessionsLimit() ?? MAX_CONCURRENT_SESSIONS
  );

  protected readonly currentPriceLabel = computed(() => {
    const sub = this.store.subscription();
    const plan = this.store.currentPlan();
    if (!sub || !plan) return '';
    const price = planPriceFor(plan, sub.provider);
    return price
      ? formatMoney(price.amountMinor, price.currency, this.#lang())
      : '';
  });

  protected readonly canCancel = computed(() => {
    const sub = this.store.subscription();
    return (
      this.store.hasActiveSubscription() &&
      sub !== null &&
      !sub.cancelAtPeriodEnd
    );
  });

  // A pending cancellation rules a switch out, as on the server.
  protected readonly canChangePlan = computed(() => {
    const sub = this.store.subscription();
    return (
      sub !== null &&
      CHANGEABLE_SUBSCRIPTION_STATUSES.includes(sub.status) &&
      !sub.cancelAtPeriodEnd
    );
  });

  // The card renders for any open subscription so the update action is
  // reachable even before a method is on file (e.g. right after checkout).
  protected readonly showPaymentMethodCard = computed(
    () =>
      this.store.paymentMethod() !== null || this.store.hasActiveSubscription()
  );

  ngOnInit(): void {
    void this.store.loadSettings();
    void this.#entitlements.load();
    const transactionId = paddleTransactionId(this.#route);
    if (transactionId) {
      void this.#payPaymentMethodChange(transactionId);
    }
  }

  /**
   * The payment-method change of a Paddle subscription comes back here, on
   * the default payment link, to open its Paddle checkout.
   */
  async #payPaymentMethodChange(transactionId: string): Promise<void> {
    const [result] = await Promise.all([
      this.#paddleCheckout.open(transactionId),
      // The message below must not show a raw key on a fresh page load.
      firstValueFrom(
        this.#transloco.load(`billing/${this.#transloco.getActiveLang()}`)
      ).catch(() => undefined)
    ]);
    dropPaddleTransactionId(this.#router);
    if (result === 'completed') {
      this.#notify.success('billing.settings.paymentMethodUpdated');
    } else if (result === 'unavailable') {
      this.#notify.error('billing.errors.paymentFormUnavailable');
    }
  }

  protected loadMoreInvoices(): void {
    this.store.loadMoreInvoices();
  }

  invoiceAmount(invoice: InvoiceResponse): string {
    return formatMoney(invoice.amountMinor, invoice.currency, this.#lang());
  }

  // CSS-safe status class (enum values like `past_due` → `status-past-due`).
  statusClass(status: string): string {
    return `status-${status.replace(/_/g, '-')}`;
  }

  onChangePlan(): void {
    const subscription = this.store.subscription();
    if (!subscription) return;
    const data: ChangePlanDialogData = {
      plans: this.store.plans(),
      subscription,
      currentPlan: this.store.currentPlan()
    };
    this.#matDialog
      .open<
        ChangePlanDialogComponent,
        ChangePlanDialogData,
        ChangePlanDialogResult
      >(ChangePlanDialogComponent, {
        ...dialogSizeConfig(DialogSize.Form),
        data
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result) => {
        if (result) {
          void this.store.changePlan(result.planKey);
        }
      });
  }

  onUpdatePaymentMethod(): void {
    void this.store.startPaymentMethodUpdate().then((session) => {
      if (session) {
        this.#checkoutRedirect.redirect(session.url);
      }
    });
  }

  onCancel(): void {
    // A metered plan is postpaid: the units of the period being closed are
    // charged at the boundary, which the generic copy does not say.
    const messageKey =
      this.store.subscription()?.billingMode === 'usage'
        ? 'billing.settings.cancelMessageUsage'
        : 'billing.settings.cancelMessage';
    this.#dialog
      .openConfirm({
        title: this.#transloco.translate('billing.settings.cancelTitle'),
        message: this.#transloco.translate(messageKey),
        confirmButton: this.#transloco.translate(
          'billing.settings.cancelConfirm'
        ),
        cancelButton: this.#transloco.translate('common.cancel'),
        icon: 'warning'
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          void this.store.cancel('period_end');
        }
      });
  }
}
