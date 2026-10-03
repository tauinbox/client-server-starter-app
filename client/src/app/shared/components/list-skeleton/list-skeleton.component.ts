import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/** The width class of one placeholder cell; it mirrors a column of the list. */
export type ListSkeletonCell =
  'narrow' | 'wide' | 'medium' | 'chip' | 'actions';

/**
 * Placeholder rows for the first load of a list. Show it only while the list
 * is empty, so a reload keeps the rows already on screen.
 */
@Component({
  selector: 'nxs-list-skeleton',
  imports: [TranslocoDirective],
  templateUrl: './list-skeleton.component.html',
  styleUrl: './list-skeleton.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ListSkeletonComponent {
  readonly rows = input(5);
  readonly cells = input<readonly ListSkeletonCell[]>([
    'wide',
    'medium',
    'medium',
    'actions'
  ]);

  protected readonly rowIndexes = computed(() =>
    Array.from({ length: this.rows() }, (_, i) => i)
  );
}
