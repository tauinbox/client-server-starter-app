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
import {
  MatButton,
  MatFabButton,
  MatIconButton
} from '@angular/material/button';
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
import type { FeatureFlagResponse } from '@app/shared/types';
import { LayoutService } from '@core/services/layout.service';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';
import { FeatureFlagsAdminStore } from '../../../store/feature-flags-admin.store';
import type {
  FeatureFlagFormDialogData,
  FeatureFlagFormDialogResult
} from '../feature-flag-form-dialog/feature-flag-form-dialog.component';
import { FeatureFlagFormDialogComponent } from '../feature-flag-form-dialog/feature-flag-form-dialog.component';

@Component({
  selector: 'nxs-feature-flag-list',
  imports: [
    DatePipe,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatButton,
    MatFabButton,
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
  templateUrl: './feature-flag-list.component.html',
  styleUrl: './feature-flag-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureFlagListComponent implements OnInit {
  readonly #store = inject(FeatureFlagsAdminStore);
  readonly #dialog = inject(MatDialog);
  readonly #adaptiveDialog = inject(AdaptiveDialogService);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #transloco = inject(TranslocoService);
  protected readonly layout = inject(LayoutService);
  protected readonly authStore = inject(AuthStore);

  readonly loading = this.#store.loading;
  readonly flags = this.#store.entities;

  readonly displayedColumns = [
    'key',
    'description',
    'enabled',
    'environments',
    'public',
    'updatedAt',
    'actions'
  ];

  readonly canManage = computed(() =>
    this.authStore.hasPermissions({ action: 'manage', subject: 'FeatureFlag' })
  );

  ngOnInit(): void {
    this.#store.load();
  }

  openCreateDialog(): void {
    this.#openDialog({});
  }

  openEditDialog(flag: FeatureFlagResponse): void {
    this.#openDialog({ flag });
  }

  toggleFlag(flag: FeatureFlagResponse): void {
    this.#store
      .toggleFlag(flag.id)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (updated) => {
          this.#notify.success(
            updated.enabled
              ? 'admin.featureFlags.successEnabled'
              : 'admin.featureFlags.successDisabled',
            { key: updated.key }
          );
        },
        error: (err) => {
          this.#notify.error(err, 'admin.featureFlags.errorToggleFailed');
        }
      });
  }

  confirmDelete(flag: FeatureFlagResponse): void {
    this.#adaptiveDialog
      .openConfirm({
        title: this.#transloco.translate(
          'admin.featureFlags.confirmDeleteTitle'
        ),
        message: this.#transloco.translate(
          'admin.featureFlags.confirmDeleteMessage',
          { key: flag.key }
        ),
        confirmButton: this.#transloco.translate('common.delete'),
        cancelButton: this.#transloco.translate('common.cancel')
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((confirmed: boolean | undefined) => {
        if (!confirmed) return;
        this.#store
          .deleteFlag(flag.id)
          .pipe(takeUntilDestroyed(this.#destroyRef))
          .subscribe({
            next: () => {
              this.#notify.success('admin.featureFlags.successDeleted', {
                key: flag.key
              });
            },
            error: (err) => {
              this.#notify.error(err, 'admin.featureFlags.errorDeleteFailed');
            }
          });
      });
  }

  #openDialog(data: FeatureFlagFormDialogData): void {
    const sizing = this.layout.isHandset()
      ? { width: '100vw', maxWidth: '100vw' }
      : dialogSizeConfig(DialogSize.Wide);
    const panelClass = this.layout.isHandset()
      ? 'app-dialog-fullscreen-mobile'
      : [];
    this.#dialog
      .open(FeatureFlagFormDialogComponent, {
        ...sizing,
        panelClass,
        data
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result: FeatureFlagFormDialogResult | undefined) => {
        if (!result) return;
        this.#applyDialogResult(data.flag, result);
      });
  }

  #applyDialogResult(
    existing: FeatureFlagResponse | undefined,
    result: FeatureFlagFormDialogResult
  ): void {
    if (!existing) {
      this.#store
        .createFlag(result.flag)
        .pipe(takeUntilDestroyed(this.#destroyRef))
        .subscribe({
          next: (created) => {
            this.#notify.success('admin.featureFlags.successCreated', {
              key: created.key
            });
            if (result.rules.length > 0) {
              this.#store
                .replaceRules(created.id, result.rules)
                .pipe(takeUntilDestroyed(this.#destroyRef))
                .subscribe({
                  error: (err) => {
                    this.#notify.error(
                      err,
                      'admin.featureFlags.errorRulesFailed'
                    );
                  }
                });
            }
          },
          error: (err) => {
            this.#notify.error(err, 'admin.featureFlags.errorCreateFailed');
          }
        });
      return;
    }

    this.#store
      .updateFlag(existing.id, result.flag, existing.version)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#notify.success('admin.featureFlags.successUpdated', {
            key: existing.key
          });
          if (result.rulesChanged) {
            this.#store
              .replaceRules(existing.id, result.rules)
              .pipe(takeUntilDestroyed(this.#destroyRef))
              .subscribe({
                error: (err) => {
                  this.#notify.error(
                    err,
                    'admin.featureFlags.errorRulesFailed'
                  );
                }
              });
          }
        },
        error: (err) => {
          this.#notify.error(err, 'admin.featureFlags.errorUpdateFailed');
        }
      });
  }
}
