import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { BillingStore } from '../store/billing.store';

/**
 * The one way back to Free: a confirmed cancel at the end of the period.
 * The settings page and the Free card of the pricing page both use it, so
 * the two show the same disclosure. Provided beside `BillingStore` on the
 * billing route.
 */
@Injectable()
export class SubscriptionCancelService {
  readonly #store = inject(BillingStore);
  readonly #dialog = inject(AdaptiveDialogService);
  readonly #transloco = inject(TranslocoService);

  /** Resolves `true` when the user confirmed and the cancel was scheduled. */
  async confirmAndCancel(): Promise<boolean> {
    const confirmed = await firstValueFrom(
      this.#dialog.openConfirm({
        title: this.#transloco.translate('billing.settings.cancelTitle'),
        message: this.#transloco.translate('billing.settings.cancelMessage'),
        confirmButton: this.#transloco.translate(
          'billing.settings.cancelConfirm'
        ),
        cancelButton: this.#transloco.translate('common.cancel'),
        icon: 'warning'
      })
    );

    return confirmed ? this.#store.cancel('period_end') : false;
  }
}
