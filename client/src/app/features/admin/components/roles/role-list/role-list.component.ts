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
import type { RoleAdminResponse } from '@app/shared/types/role.types';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthService } from '@features/auth/services/auth.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';
import { RolesStore } from '../../../store/roles.store';
import type {
  RoleFormDialogData,
  RoleFormDialogResult
} from '../role-form-dialog/role-form-dialog.component';
import { RoleFormDialogComponent } from '../role-form-dialog/role-form-dialog.component';
import type { RolePermissionsDialogData } from '../role-permissions-dialog/role-permissions-dialog.component';
import { RolePermissionsDialogComponent } from '../role-permissions-dialog/role-permissions-dialog.component';

@Component({
  selector: 'nxs-role-list',
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
    MatCell,
    TranslocoDirective
  ],
  templateUrl: './role-list.component.html',
  styleUrl: './role-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoleListComponent implements OnInit {
  readonly #rolesStore = inject(RolesStore);
  readonly #dialog = inject(MatDialog);
  readonly #adaptiveDialog = inject(AdaptiveDialogService);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #authService = inject(AuthService);
  readonly #translocoService = inject(TranslocoService);
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
    this.authStore.hasPermissions({ action: 'create', subject: 'Role' })
  );
  readonly canUpdate = computed(() =>
    this.authStore.hasPermissions({ action: 'update', subject: 'Role' })
  );
  readonly canDelete = computed(() =>
    this.authStore.hasPermissions({ action: 'delete', subject: 'Role' })
  );

  ngOnInit(): void {
    this.#rolesStore.load();
  }

  openCreateDialog(): void {
    const data: RoleFormDialogData = {};
    this.#dialog
      .open(RoleFormDialogComponent, {
        ...dialogSizeConfig(DialogSize.Form),
        data
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result: RoleFormDialogResult | undefined) => {
        if (result) {
          this.#rolesStore
            .createRole(result)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#notify.success('admin.roles.successCreated');
              },
              error: (err) => {
                this.#notify.error(err, 'admin.roles.errorCreateFailed');
              }
            });
        }
      });
  }

  openEditDialog(role: RoleAdminResponse): void {
    const data: RoleFormDialogData = { role };
    this.#dialog
      .open(RoleFormDialogComponent, {
        ...dialogSizeConfig(DialogSize.Form),
        data
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result: RoleFormDialogResult | undefined) => {
        if (result) {
          this.#rolesStore
            .updateRole(role.id, result)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#notify.success('admin.roles.successUpdated');
              },
              error: (err) => {
                this.#notify.error(err, 'admin.roles.errorUpdateFailed');
              }
            });
        }
      });
  }

  openPermissionsDialog(role: RoleAdminResponse): void {
    const data: RolePermissionsDialogData = {
      role,
      readonly: !this.canUpdate()
    };
    this.#dialog
      .open(RolePermissionsDialogComponent, {
        ...dialogSizeConfig(DialogSize.Wide),
        data
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((changed: boolean | undefined) => {
        if (changed) {
          this.#notify.success('admin.roles.permissionsUpdated');
          void this.#authService.fetchPermissions();
        }
      });
  }

  confirmDelete(role: RoleAdminResponse): void {
    this.#adaptiveDialog
      .openConfirm({
        title: this.#translocoService.translate(
          'admin.roles.confirmDeleteTitle'
        ),
        message: this.#translocoService.translate(
          'admin.roles.confirmDeleteMessage',
          { name: role.name }
        ),
        confirmButton: this.#translocoService.translate('common.delete'),
        cancelButton: this.#translocoService.translate('common.cancel')
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((confirmed: boolean | undefined) => {
        if (confirmed) {
          this.#rolesStore
            .deleteRole(role.id)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#notify.success('admin.roles.successDeleted');
              },
              error: (err) => {
                this.#notify.error(err, 'admin.roles.errorDeleteFailed');
              }
            });
        }
      });
  }
}
