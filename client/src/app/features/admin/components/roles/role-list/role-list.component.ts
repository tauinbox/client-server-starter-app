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
import type { RoleResponse } from '@app/shared/types/role.types';
import { AuthStore } from '@features/auth/store/auth.store';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { rem } from '@shared/utils/css.utils';
import { RolesStore } from '../../../store/roles.store';
import type {
  RoleFormDialogData,
  RoleFormDialogResult
} from '../role-form-dialog/role-form-dialog.component';
import { RoleFormDialogComponent } from '../role-form-dialog/role-form-dialog.component';
import type { RolePermissionsDialogData } from '../role-permissions-dialog/role-permissions-dialog.component';
import { RolePermissionsDialogComponent } from '../role-permissions-dialog/role-permissions-dialog.component';

@Component({
  selector: 'app-role-list',
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
  templateUrl: './role-list.component.html',
  styleUrl: './role-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoleListComponent implements OnInit {
  readonly #rolesStore = inject(RolesStore);
  readonly #dialog = inject(MatDialog);
  readonly #snackBar = inject(MatSnackBar);
  readonly #destroyRef = inject(DestroyRef);
  protected readonly authStore = inject(AuthStore);

  readonly loading = this.#rolesStore.loading;
  readonly roles = this.#rolesStore.entities;

  readonly displayedColumns = [
    'name',
    'description',
    'type',
    'createdAt',
    'actions'
  ];

  readonly canCreate = computed(() =>
    this.authStore.hasPermission('create', 'Role')
  );
  readonly canUpdate = computed(() =>
    this.authStore.hasPermission('update', 'Role')
  );
  readonly canDelete = computed(() =>
    this.authStore.hasPermission('delete', 'Role')
  );

  ngOnInit(): void {
    this.#rolesStore.load();
  }

  openCreateDialog(): void {
    const data: RoleFormDialogData = {};
    this.#dialog
      .open(RoleFormDialogComponent, { width: rem(480), data })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result: RoleFormDialogResult | undefined) => {
        if (result) {
          this.#rolesStore
            .createRole(result)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#snackBar.open('Role created successfully', 'Close', {
                  duration: 5000
                });
              },
              error: (err) => {
                this.#snackBar.open(
                  (err.error?.message as string) || 'Failed to create role.',
                  'Close',
                  { duration: 5000 }
                );
              }
            });
        }
      });
  }

  openEditDialog(role: RoleResponse): void {
    const data: RoleFormDialogData = { role };
    this.#dialog
      .open(RoleFormDialogComponent, { width: rem(480), data })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result: RoleFormDialogResult | undefined) => {
        if (result) {
          this.#rolesStore
            .updateRole(role.id, result)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#snackBar.open('Role updated successfully', 'Close', {
                  duration: 5000
                });
              },
              error: (err) => {
                this.#snackBar.open(
                  (err.error?.message as string) || 'Failed to update role.',
                  'Close',
                  { duration: 5000 }
                );
              }
            });
        }
      });
  }

  openPermissionsDialog(role: RoleResponse): void {
    const data: RolePermissionsDialogData = { role };
    this.#dialog
      .open(RolePermissionsDialogComponent, { width: rem(560), data })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((changed: boolean | undefined) => {
        if (changed) {
          this.#snackBar.open('Permissions updated successfully', 'Close', {
            duration: 5000
          });
        }
      });
  }

  confirmDelete(role: RoleResponse): void {
    this.#dialog
      .open(ConfirmDialogComponent, {
        width: rem(350),
        data: {
          title: 'Delete Role',
          message: `Are you sure you want to delete the role "${role.name}"?`,
          confirmButton: 'Delete',
          cancelButton: 'Cancel'
        }
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((confirmed: boolean | undefined) => {
        if (confirmed) {
          this.#rolesStore
            .deleteRole(role.id)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#snackBar.open('Role deleted successfully', 'Close', {
                  duration: 5000
                });
              },
              error: (err) => {
                this.#snackBar.open(
                  (err.error?.message as string) || 'Failed to delete role.',
                  'Close',
                  { duration: 5000 }
                );
              }
            });
        }
      });
  }
}
