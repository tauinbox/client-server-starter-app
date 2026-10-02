import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  viewChild
} from '@angular/core';
import {
  MatButtonToggleGroup,
  MatButtonToggleModule
} from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import type { BillingRegion } from '@app/shared/types';
import { AuthStore } from '@features/auth/store/auth.store';
import { BillingStore } from '../../store/billing.store';

/**
 * Billing region control of the pricing and settings pages (design section 19).
 * It needs a known region (the endpoint requires auth) and a choice: two
 * available providers, or one available provider that the stored region
 * does not resolve to, so the user can leave a provider that was turned off.
 */
@Component({
  selector: 'nxs-region-control',
  imports: [MatButtonToggleModule, MatIcon, TranslocoDirective],
  templateUrl: './region-control.component.html',
  styleUrl: './region-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RegionControlComponent {
  protected readonly store = inject(BillingStore);
  readonly #authStore = inject(AuthStore);

  readonly regionToggle = viewChild(MatButtonToggleGroup);

  protected readonly visible = computed(() => {
    const region = this.store.region();
    if (!this.#authStore.isAuthenticated() || !region) return false;
    const available = region.availableProviders;
    return (
      available.length > 1 ||
      (available.length === 1 && !available.includes(region.effectiveProvider))
    );
  });

  protected readonly regionOptions: readonly BillingRegion[] = [
    'auto',
    'ru',
    'world'
  ];

  // The group keeps the clicked value on a refusal, because the stored region
  // does not change and the [value] binding therefore does not fire again.
  onRegionChange(region: BillingRegion): void {
    void this.store.setRegion(region).then((updated) => {
      const toggle = this.regionToggle();
      if (!updated && toggle) {
        toggle.value = this.store.region()?.region;
      }
    });
  }
}
