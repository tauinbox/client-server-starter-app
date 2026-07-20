import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject
} from '@angular/core';
import { DatePipe, SlicePipe } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable
} from '@angular/material/table';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { InvoiceResponse, SubscriptionResponse } from '@app/shared/types';
import { LayoutService } from '@core/services/layout.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { formatMoney } from '@features/billing/utils/billing-format';
import type { CancelMode } from '@features/billing/services/billing.service';
import { BillingAdminStore } from '../../store/billing-admin.store';

/**
 * Admin-shell billing console: a read view of every
 * customer's subscriptions and invoices with two mutations — cancel a
 * subscription (end-of-period or immediate) and refund a paid invoice. Access
 * is gated by the CASL `manage Billing` permission both at the route and here
 * (action buttons hide without it).
 */
@Component({
  selector: 'nxs-billing-admin-list',
  imports: [
    DatePipe,
    SlicePipe,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatIconButton,
    MatIcon,
    MatProgressSpinner,
    MatTooltip,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTable,
    MatColumnDef,
    MatHeaderCell,
    MatCellDef,
    MatHeaderRow,
    MatRow,
    MatHeaderCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatCell,
    TranslocoDirective
  ],
  templateUrl: './billing-admin-list.component.html',
  styleUrl: './billing-admin-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BillingAdminListComponent implements OnInit {
  readonly #store = inject(BillingAdminStore);
  readonly #adaptiveDialog = inject(AdaptiveDialogService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #transloco = inject(TranslocoService);
  protected readonly layout = inject(LayoutService);
  protected readonly authStore = inject(AuthStore);

  readonly loading = this.#store.loading;
  readonly working = this.#store.working;
  readonly subscriptions = this.#store.subscriptions;
  readonly invoices = this.#store.invoices;

  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  readonly subscriptionColumns = [
    'customer',
    'plan',
    'provider',
    'mode',
    'status',
    'renews',
    'actions'
  ];
  readonly invoiceColumns = [
    'reference',
    'customer',
    'amount',
    'status',
    'period',
    'actions'
  ];

  readonly canManage = computed(() =>
    this.authStore.hasPermissions({ action: 'manage', subject: 'Billing' })
  );

  ngOnInit(): void {
    void this.#store.load();
  }

  invoiceAmount(invoice: InvoiceResponse): string {
    return formatMoney(invoice.amountMinor, invoice.currency, this.#lang());
  }

  // CSS-safe status class (enum values like `past_due` → `status-past-due`).
  statusClass(status: string): string {
    return `status-${status.replace(/_/g, '-')}`;
  }

  // A canceled subscription has no further lifecycle action.
  canCancel(subscription: SubscriptionResponse): boolean {
    return subscription.status !== 'canceled';
  }

  // Only paid invoices can be refunded (mirrors the server guard).
  canRefund(invoice: InvoiceResponse): boolean {
    return invoice.status === 'paid';
  }

  confirmCancel(subscription: SubscriptionResponse, mode: CancelMode): void {
    if (this.working()) {
      return;
    }

    this.#adaptiveDialog
      .openConfirm({
        title: this.#transloco.translate('admin.billing.cancelTitle'),
        message: this.#transloco.translate(
          mode === 'immediate'
            ? 'admin.billing.cancelImmediateMessage'
            : 'admin.billing.cancelPeriodEndMessage'
        ),
        confirmButton: this.#transloco.translate('admin.billing.cancelConfirm'),
        cancelButton: this.#transloco.translate('common.cancel'),
        icon: 'warning'
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((confirmed) => {
        // Re-check: another mutation may have started while the dialog was open.
        if (confirmed && !this.working()) {
          void this.#store.cancelSubscription(subscription.id, mode);
        }
      });
  }

  confirmRefund(invoice: InvoiceResponse): void {
    if (this.working()) {
      return;
    }

    this.#adaptiveDialog
      .openConfirm({
        title: this.#transloco.translate('admin.billing.refundTitle'),
        message: this.#transloco.translate('admin.billing.refundMessage', {
          amount: this.invoiceAmount(invoice)
        }),
        confirmButton: this.#transloco.translate('admin.billing.refundConfirm'),
        cancelButton: this.#transloco.translate('common.cancel'),
        icon: 'warning'
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((confirmed) => {
        // Re-check: another mutation may have started while the dialog was open.
        if (confirmed && !this.working()) {
          void this.#store.refundInvoice(invoice.id);
        }
      });
  }
}
