import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type {
  BillingMode,
  PlanResponse,
  ProrationPreviewResponse,
  SubscriptionResponse
} from '@app/shared/types';
import { BillingService } from '../../services/billing.service';
import { formatMoney, planPriceFor } from '../../utils/billing-format';

export type ChangePlanDialogData = {
  plans: PlanResponse[];
  subscription: SubscriptionResponse;
  currentPlan: PlanResponse | null;
};

export type ChangePlanDialogResult = {
  planKey: string;
};

type PlanOption = {
  key: string;
  name: string;
  description: string | null;
  price: string;
  priceSuffixKey: string;
};

type ProrationLedger = {
  split: boolean;
  credit: string | null;
  charge: string | null;
  dueNow: string;
  refundDue: boolean;
};

// Typographic minus/plus prefixes for the ledger legs (U+2212, not a hyphen).
const MINUS = '− ';
const PLUS = '+ ';

/**
 * Change-plan dialog with a live proration preview. The target
 * is picked as billing mode + plan; every selection fetches the prorated cost
 * and renders it as an itemized mini-ledger ending in a bold "Due now". The
 * dialog only previews — it closes with the chosen plan key and the caller
 * applies the change, mirroring the cancel-confirmation pattern.
 */
@Component({
  selector: 'nxs-change-plan-dialog',
  imports: [
    DatePipe,
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIcon,
    MatProgressSpinner,
    TranslocoDirective
  ],
  templateUrl: './change-plan-dialog.component.html',
  styleUrl: './change-plan-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChangePlanDialogComponent {
  readonly #dialogRef = inject(
    MatDialogRef<ChangePlanDialogComponent, ChangePlanDialogResult>
  );
  readonly #billing = inject(BillingService);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  protected readonly data = inject<ChangePlanDialogData>(MAT_DIALOG_DATA);

  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  protected readonly mode = signal<BillingMode>(
    this.data.subscription.billingMode
  );
  protected readonly selectedKey = signal<string | null>(null);
  protected readonly preview = signal<ProrationPreviewResponse | null>(null);
  protected readonly previewLoading = signal(false);
  protected readonly previewError = signal(false);

  // Stale-response guard: only the latest selection's preview may land.
  #previewSeq = 0;

  protected readonly isTrial = this.data.subscription.status === 'trialing';
  protected readonly periodEnd = this.data.subscription.currentPeriodEnd;
  protected readonly currentPlanName =
    this.data.currentPlan?.name ?? this.data.subscription.planKey;

  /** Valid switch targets for the picked mode, priced for the sub's provider. */
  protected readonly options = computed<PlanOption[]>(() => {
    const lang = this.#lang();
    const { provider, planKey } = this.data.subscription;
    return this.data.plans
      .filter(
        (plan) =>
          plan.active &&
          plan.billingMode === this.mode() &&
          plan.key !== planKey &&
          !!plan.prices[provider]
      )
      .map((plan) => {
        const price = planPriceFor(plan, provider);
        const isUsage = plan.billingMode === 'usage';
        const amountMinor = isUsage
          ? (price?.unitPriceMinor ?? 0)
          : (price?.amountMinor ?? 0);
        return {
          key: plan.key,
          name: plan.name,
          description: plan.description,
          price: price ? formatMoney(amountMinor, price.currency, lang) : '',
          priceSuffixKey: isUsage
            ? 'billing.changePlan.perUnit'
            : 'billing.pricing.perMonth'
        };
      });
  });

  protected readonly selectedPlanName = computed(() => {
    const key = this.selectedKey();
    if (!key) return null;
    return this.data.plans.find((plan) => plan.key === key)?.name ?? key;
  });

  /**
   * The preview rendered as ledger lines. Split (credit/charge) legs are only
   * available from the self-managed provider; the delegated one returns just
   * the net amount. A negative net is presented as a refund of its absolute
   * value instead of a "due" with a minus sign.
   */
  protected readonly ledger = computed<ProrationLedger | null>(() => {
    const preview = this.preview();
    if (!preview) return null;
    const lang = this.#lang();
    const split = preview.creditMinor !== null && preview.chargeMinor !== null;
    const refundDue = preview.dueNowMinor < 0;
    return {
      split,
      credit: split
        ? MINUS + formatMoney(preview.creditMinor!, preview.currency, lang)
        : null,
      charge: split
        ? PLUS + formatMoney(preview.chargeMinor!, preview.currency, lang)
        : null,
      dueNow: formatMoney(
        Math.abs(preview.dueNowMinor),
        preview.currency,
        lang
      ),
      refundDue
    };
  });

  protected readonly canConfirm = computed(
    () =>
      this.selectedKey() !== null &&
      this.preview() !== null &&
      !this.previewLoading() &&
      !this.previewError()
  );

  setMode(mode: BillingMode): void {
    if (mode === this.mode()) return;
    this.mode.set(mode);
    this.selectedKey.set(null);
    this.preview.set(null);
    this.previewError.set(false);
    // A single target (the pay-as-you-go plan) needs no extra click.
    const options = this.options();
    if (options.length === 1) this.select(options[0].key);
  }

  select(planKey: string): void {
    if (planKey === this.selectedKey()) return;
    this.selectedKey.set(planKey);
    this.preview.set(null);
    this.previewError.set(false);
    this.previewLoading.set(true);

    const seq = ++this.#previewSeq;
    this.#billing
      .previewChange(planKey)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (preview) => {
          if (seq !== this.#previewSeq) return;
          this.preview.set(preview);
          this.previewLoading.set(false);
        },
        error: () => {
          if (seq !== this.#previewSeq) return;
          this.previewError.set(true);
          this.previewLoading.set(false);
        }
      });
  }

  confirm(): void {
    const planKey = this.selectedKey();
    if (!planKey || !this.canConfirm()) return;
    this.#dialogRef.close({ planKey });
  }

  cancel(): void {
    this.#dialogRef.close();
  }
}
