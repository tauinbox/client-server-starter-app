import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatButton, MatIconButton } from '@angular/material/button';
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
import type { ActionResponse } from '@app/shared/types/rbac.types';
import { AuthStore } from '@features/auth/store/auth.store';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';
import { ResourcesStore } from '../../../store/resources.store';
import type {
  ActionFormDialogData,
  ActionFormDialogResult
} from '../action-form-dialog/action-form-dialog.component';
import { ActionFormDialogComponent } from '../action-form-dialog/action-form-dialog.component';

@Component({
  selector: 'app-action-list',
  imports: [
    DatePipe,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatButton,
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
  templateUrl: './action-list.component.html',
  styleUrl: './action-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActionListComponent implements OnInit {
  readonly #resourcesStore = inject(ResourcesStore);
  readonly #dialog = inject(MatDialog);
  readonly #snackBar = inject(MatSnackBar);
  readonly #destroyRef = inject(DestroyRef);
  protected readonly authStore = inject(AuthStore);

  readonly loading = this.#resourcesStore.loading;
  readonly actions = this.#resourcesStore.actions;

  readonly actionColumns = [
    'displayName',
    'name',
    'description',
    'default',
    'createdAt',
    'actions'
  ];

  readonly canUpdate = computed(() =>
    this.authStore.hasPermissions({ action: 'update', subject: 'Permission' })
  );
  readonly canCreate = computed(() =>
    this.authStore.hasPermissions({ action: 'create', subject: 'Permission' })
  );
  readonly canDelete = computed(() =>
    this.authStore.hasPermissions({ action: 'delete', subject: 'Permission' })
  );

  ngOnInit(): void {
    this.#resourcesStore.load();
  }

  openAddAction(): void {
    const data: ActionFormDialogData = {};
    this.#dialog
      .open(ActionFormDialogComponent, {
        ...dialogSizeConfig(DialogSize.Form),
        data
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result: ActionFormDialogResult | undefined) => {
        if (result) {
          this.#resourcesStore
            .createAction(result)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#snackBar.open('Action created successfully', 'Close', {
                  duration: 5000
                });
              },
              error: (err: { error?: { message?: string } }) => {
                this.#snackBar.open(
                  err.error?.message ?? 'Failed to create action.',
                  'Close',
                  { duration: 5000 }
                );
              }
            });
        }
      });
  }

  openEditAction(action: ActionResponse): void {
    const data: ActionFormDialogData = { action };
    this.#dialog
      .open(ActionFormDialogComponent, {
        ...dialogSizeConfig(DialogSize.Form),
        data
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result: ActionFormDialogResult | undefined) => {
        if (result) {
          this.#resourcesStore
            .updateAction(action.id, result)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#snackBar.open('Action updated successfully', 'Close', {
                  duration: 5000
                });
              },
              error: (err: { error?: { message?: string } }) => {
                this.#snackBar.open(
                  err.error?.message ?? 'Failed to update action.',
                  'Close',
                  { duration: 5000 }
                );
              }
            });
        }
      });
  }

  confirmDeleteAction(action: ActionResponse): void {
    this.#dialog
      .open(ConfirmDialogComponent, {
        ...dialogSizeConfig(DialogSize.Confirm),
        data: {
          title: 'Delete Action',
          message: `Are you sure you want to delete the action "${action.displayName}"?`,
          confirmButton: 'Delete',
          cancelButton: 'Cancel',
          icon: 'warning'
        }
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((confirmed: boolean | undefined) => {
        if (confirmed) {
          this.#resourcesStore
            .deleteAction(action.id)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#snackBar.open('Action deleted successfully', 'Close', {
                  duration: 5000
                });
              },
              error: (err: { error?: { message?: string } }) => {
                this.#snackBar.open(
                  err.error?.message ?? 'Failed to delete action.',
                  'Close',
                  { duration: 5000 }
                );
              }
            });
        }
      });
  }
}
