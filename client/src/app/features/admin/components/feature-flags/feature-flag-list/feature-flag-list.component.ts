import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
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
import { InfiniteScrollDirective } from '@shared/directives/infinite-scroll.directive';
import {
  ListSkeletonComponent,
  type ListSkeletonCell
} from '@shared/components/list-skeleton/list-skeleton.component';
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
    LocalizedDatePipe,
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
    InfiniteScrollDirective,
    ListSkeletonComponent,
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
  readonly hasMore = this.#store.hasMore;
  readonly isLoadingMore = this.#store.isLoadingMore;
  readonly busy = computed(
    () => this.#store.loading() || this.#store.isLoadingMore()
  );

  loadMore(): void {
    this.#store.loadMore();
  }
  readonly flags = this.#store.entities;

  readonly skeletonCells: readonly ListSkeletonCell[] = [
    'medium',
    'wide',
    'chip',
    'chip',
    'chip',
    'medium',
    'actions'
  ];

  readonly displayedColumns = [
    'key',
    'description',
    'enabled',
    'environments',
    'public',
    'updatedAt',
    'actions'
  ];

  readonly canCreate = computed(() =>
    this.authStore.hasPermissions({ action: 'create', subject: 'FeatureFlag' })
  );
  readonly canUpdate = computed(() =>
    this.authStore.hasPermissions({ action: 'update', subject: 'FeatureFlag' })
  );
  readonly canDelete = computed(() =>
    this.authStore.hasPermissions({ action: 'delete', subject: 'FeatureFlag' })
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
    // Enabling a flag that has no include rules turns it on for every
    // authenticated user (the evaluator defaults to "on" with no include
    // rules), so confirm that intent before flipping it on. Disabling and
    // flags that already target a subset via include rules flip silently.
    const enabling = !flag.enabled;
    if (enabling && !this.#hasIncludeRules(flag)) {
      this.#adaptiveDialog
        .openConfirm({
          title: this.#transloco.translate(
            'admin.featureFlags.confirmEnableNoRulesTitle'
          ),
          message: this.#transloco.translate(
            'admin.featureFlags.confirmEnableNoRulesMessage',
            { key: flag.key }
          ),
          confirmButton: this.#transloco.translate('common.confirm'),
          cancelButton: this.#transloco.translate('common.cancel')
        })
        .pipe(takeUntilDestroyed(this.#destroyRef))
        .subscribe((confirmed: boolean | undefined) => {
          if (confirmed) this.#applyToggle(flag);
        });
      return;
    }
    this.#applyToggle(flag);
  }

  #applyToggle(flag: FeatureFlagResponse): void {
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

  #hasIncludeRules(flag: FeatureFlagResponse): boolean {
    return flag.rules.some((r) => r.effect === 'include');
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
    const save$ = existing
      ? this.#store.updateFlag(existing.id, result.flag, existing.version)
      : this.#store.createFlag({ key: result.key, ...result.flag });
    save$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe({
      next: (saved) => {
        this.#notify.success(
          existing
            ? 'admin.featureFlags.successUpdated'
            : 'admin.featureFlags.successCreated',
          { key: saved.key }
        );
      },
      error: (err) => {
        this.#notify.error(
          err,
          existing
            ? 'admin.featureFlags.errorUpdateFailed'
            : 'admin.featureFlags.errorCreateFailed'
        );
      }
    });
  }
}
