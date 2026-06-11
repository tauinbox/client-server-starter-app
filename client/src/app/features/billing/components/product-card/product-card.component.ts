import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output
} from '@angular/core';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import type { ProductResponse } from '@app/shared/types';

/**
 * Presentational one-time product card (design §21.4): a fixed-price
 * sku/credits catalog entry rendered as a horizontal "ticket" — leading tonal
 * icon, name + description, and a price/buy stub split off by a dashed rule.
 * Emits `buy` when the call-to-action is pressed; the parent owns the
 * purchase.
 */
@Component({
  selector: 'nxs-product-card',
  imports: [MatCard, MatCardContent, MatButton, MatIcon, TranslocoDirective],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProductCardComponent {
  readonly product = input.required<ProductResponse>();
  /** Formatted, currency-aware price for the resolved provider. */
  readonly price = input.required<string>();
  readonly disabled = input(false);

  readonly buy = output<string>();

  protected readonly icon = computed(() =>
    this.product().type === 'credits' ? 'toll' : 'workspace_premium'
  );

  /** The entitlement a paid sku unlocks, for the meta chip. */
  protected readonly grantEntitlement = computed(
    () => this.product().grant?.entitlement ?? null
  );

  protected readonly grantDays = computed(
    () => this.product().grant?.durationDays ?? null
  );

  onBuy(): void {
    this.buy.emit(this.product().key);
  }
}
