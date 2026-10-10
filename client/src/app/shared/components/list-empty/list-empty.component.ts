import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The empty state of a list page. With active filters it says that no row
 * matches them; without filters it shows `message`, "No <entities> yet".
 */
@Component({
  selector: 'nxs-list-empty',
  imports: [MatIcon, TranslocoDirective],
  templateUrl: './list-empty.component.html',
  styleUrl: './list-empty.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ListEmptyComponent {
  readonly icon = input.required<string>();

  /** The translated text for a list that has no rows yet. */
  readonly message = input.required<string>();

  readonly filtered = input(false);
}
