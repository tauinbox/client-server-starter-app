import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatChip } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
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
import type { ResourceResponse } from '@app/shared/types/rbac.types';
import { AuthStore } from '@features/auth/store/auth.store';
import { rem } from '@shared/utils/css.utils';
import { ResourcesStore } from '../../../store/resources.store';
import type {
  ResourceFormDialogData,
  ResourceFormDialogResult
} from '../resource-form-dialog/resource-form-dialog.component';
import { ResourceFormDialogComponent } from '../resource-form-dialog/resource-form-dialog.component';

@Component({
  selector: 'app-resource-list',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatIconButton,
    MatIcon,
    MatProgressSpinner,
    MatTooltip,
    MatChip,
    MatTable,
    MatColumnDef,
    MatHeaderCell,
    MatCellDef,
    MatHeaderRow,
    MatRow,
    MatHeaderCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatCell
  ],
  templateUrl: './resource-list.component.html',
  styleUrl: './resource-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResourceListComponent implements OnInit {
  readonly #resourcesStore = inject(ResourcesStore);
  readonly #dialog = inject(MatDialog);
  readonly #snackBar = inject(MatSnackBar);
  readonly #destroyRef = inject(DestroyRef);
  protected readonly authStore = inject(AuthStore);

  readonly loading = this.#resourcesStore.loading;
  readonly resources = this.#resourcesStore.resources;

  readonly resourceColumns = [
    'displayName',
    'name',
    'subject',
    'description',
    'system',
    'actions'
  ];

  readonly canUpdate = computed(() =>
    this.authStore.hasPermissions({ action: 'update', subject: 'Permission' })
  );

  ngOnInit(): void {
    this.#resourcesStore.load();
  }

  openEditResource(resource: ResourceResponse): void {
    const data: ResourceFormDialogData = {
      resource,
      actions: this.#resourcesStore.actions()
    };
    this.#dialog
      .open(ResourceFormDialogComponent, { width: rem(480), data })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result: ResourceFormDialogResult | undefined) => {
        if (result) {
          this.#resourcesStore
            .updateResource(resource.id, result)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#snackBar.open('Resource updated successfully', 'Close', {
                  duration: 5000
                });
              },
              error: (err: { error?: { message?: string } }) => {
                this.#snackBar.open(
                  err.error?.message ?? 'Failed to update resource.',
                  'Close',
                  { duration: 5000 }
                );
              }
            });
        }
      });
  }
}
