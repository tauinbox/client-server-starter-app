import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { InvoiceResponse } from '@app/shared/types';
import { LayoutService } from '@core/services/layout.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { BillingStore } from '../../store/billing.store';
import { formatMoney, planPriceFor } from '../../utils/billing-format';
import { UsageMeterComponent } from '../usage-meter/usage-meter.component';

@Component({
  selector: 'nxs-billing-settings',
  imports: [
    DatePipe,
    RouterLink,
    MatCard,
    MatCardContent,
    MatButton,
    MatIcon,
    MatProgressSpinner,
    TranslocoDirective,
    UsageMeterComponent
  ],
  templateUrl: './billing-settings.component.html',
  styleUrl: './billing-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BillingSettingsComponent implements OnInit {
  protected readonly store = inject(BillingStore);
  readonly #layout = inject(LayoutService);
  readonly #dialog = inject(AdaptiveDialogService);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);

  protected readonly billingRoute = `/${AppRouteSegmentEnum.Billing}`;
  protected readonly isHandset = this.#layout.isHandset;

  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

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

  ngOnInit(): void {
    void this.store.loadSettings();
  }

  invoiceAmount(invoice: InvoiceResponse): string {
    return formatMoney(invoice.amountMinor, invoice.currency, this.#lang());
  }

  // CSS-safe status class (enum values like `past_due` → `status-past-due`).
  statusClass(status: string): string {
    return `status-${status.replace(/_/g, '-')}`;
  }

  onCancel(): void {
    this.#dialog
      .openConfirm({
        title: this.#transloco.translate('billing.settings.cancelTitle'),
        message: this.#transloco.translate('billing.settings.cancelMessage'),
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
