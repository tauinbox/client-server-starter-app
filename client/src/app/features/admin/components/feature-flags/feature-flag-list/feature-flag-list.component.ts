import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal
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

  // Flags whose `replaceRules` call failed after a successful flag create/update
  // in this session. Surfaces a warning marker so the admin can spot the
  // partial-save state after the snackbar has dismissed.
  readonly #rulesFailedFlagIds = signal<ReadonlySet<string>>(new Set());
  readonly rulesFailedFlagIds = this.#rulesFailedFlagIds.asReadonly();

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
    const knownEnvironments = Array.from(
      new Set(this.flags().flatMap((f) => f.environments))
    );
    this.#dialog
      .open(FeatureFlagFormDialogComponent, {
        ...sizing,
        panelClass,
        data: { ...data, knownEnvironments }
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
            // No rules on a brand-new flag → nothing to PUT, success is final.
            if (result.rules.length === 0) {
              this.#notify.success('admin.featureFlags.successCreated', {
                key: created.key
              });
              return;
            }
            this.#applyRules(
              created,
              result.rules,
              'admin.featureFlags.successCreated',
              'admin.featureFlags.errorRulesFailedCreate'
            );
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
        next: (updated) => {
          // `rulesChanged` covers both "rules edited" and "all rules removed";
          // the latter still needs a replaceRules([]) to clear them server-side,
          // so we always go through #applyRules when the flag is true.
          if (!result.rulesChanged) {
            this.#notify.success('admin.featureFlags.successUpdated', {
              key: updated.key
            });
            return;
          }
          this.#applyRules(
            updated,
            result.rules,
            'admin.featureFlags.successUpdated',
            'admin.featureFlags.errorRulesFailedUpdate'
          );
        },
        error: (err) => {
          this.#notify.error(err, 'admin.featureFlags.errorUpdateFailed');
        }
      });
  }

  // Saves rules after a successful create/update. Defers the success snackbar
  // until both steps resolve so the user never sees "Flag saved" while rules
  // silently failed. Tracks failed flag ids so the row can surface a warning
  // marker after the snackbar dismisses.
  #applyRules(
    flag: FeatureFlagResponse,
    rules: FeatureFlagFormDialogResult['rules'],
    successKey: string,
    rulesErrorKey: string
  ): void {
    this.#store
      .replaceRules(flag.id, rules)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#notify.success(successKey, { key: flag.key });
          this.#clearRulesFailed(flag.id);
        },
        error: () => {
          this.#markRulesFailed(flag.id);
          this.#notify.error(rulesErrorKey, { key: flag.key });
        }
      });
  }

  #markRulesFailed(flagId: string): void {
    const current = this.#rulesFailedFlagIds();
    if (current.has(flagId)) return;
    const next = new Set(current);
    next.add(flagId);
    this.#rulesFailedFlagIds.set(next);
  }

  #clearRulesFailed(flagId: string): void {
    const current = this.#rulesFailedFlagIds();
    if (!current.has(flagId)) return;
    const next = new Set(current);
    next.delete(flagId);
    this.#rulesFailedFlagIds.set(next);
  }
}
