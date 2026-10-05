import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  ViewContainerRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import type { HttpErrorResponse } from '@angular/common/http';
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
import {
  MatSlideToggle,
  type MatSlideToggleChange
} from '@angular/material/slide-toggle';
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
import { MatSort, MatSortHeader, type Sort } from '@angular/material/sort';
import { InfiniteScrollDirective } from '@shared/directives/infinite-scroll.directive';
import { bindListToUrl } from '@shared/store/bind-list-to-url';
import { TemplateRowOfDirective } from '@shared/directives/template-row-of.directive';
import {
  ListSkeletonComponent,
  type ListSkeletonCell
} from '@shared/components/list-skeleton/list-skeleton.component';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { FeatureFlagResponse } from '@app/shared/types';
import {
  APP_ENVIRONMENTS,
  ErrorKeys,
  type FeatureFlagListQuery
} from '@app/shared/constants';
import {
  NxsListFiltersComponent,
  type ListFilterControl
} from '@shared/forms/nxs-list-filters/nxs-list-filters.component';
import { LayoutService } from '@core/services/layout.service';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';
import { FeatureFlagsAdminStore } from '../../../store/feature-flags-admin.store';
import {
  confirmEnableForEveryone,
  hasIncludeRule
} from '../../../utils/feature-flag-enable-confirm';
import type { FeatureFlagFormDialogData } from '../feature-flag-form-dialog/feature-flag-form-dialog.component';
import { FeatureFlagFormDialogComponent } from '../feature-flag-form-dialog/feature-flag-form-dialog.component';

@Component({
  selector: 'nxs-feature-flag-list',
  imports: [
    NgTemplateOutlet,
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
    MatSlideToggle,
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
    MatSort,
    MatSortHeader,
    InfiniteScrollDirective,
    TemplateRowOfDirective,
    ListSkeletonComponent,
    NxsListFiltersComponent,
    TranslocoDirective
  ],
  templateUrl: './feature-flag-list.component.html',
  styleUrl: './feature-flag-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureFlagListComponent {
  readonly #store = inject(FeatureFlagsAdminStore);
  readonly #dialog = inject(MatDialog);
  readonly #adaptiveDialog = inject(AdaptiveDialogService);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #transloco = inject(TranslocoService);
  readonly #viewContainerRef = inject(ViewContainerRef);
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
  readonly filters = this.#store.filters;
  readonly hasActiveFilters = this.#store.hasActiveFilters;

  readonly filterControls: readonly ListFilterControl<FeatureFlagListQuery>[] =
    [
      {
        kind: 'select',
        key: 'enabled',
        label: 'admin.featureFlags.filterStatus',
        allLabel: 'common.all',
        options: [
          { value: true, label: 'admin.featureFlags.statusEnabled' },
          { value: false, label: 'admin.featureFlags.statusDisabled' }
        ]
      },
      {
        kind: 'select',
        key: 'public',
        label: 'admin.featureFlags.tableHeaderPublic',
        allLabel: 'common.all',
        options: [
          { value: true, label: 'common.yes' },
          { value: false, label: 'common.no' }
        ]
      },
      {
        kind: 'select',
        key: 'environment',
        label: 'admin.featureFlags.tableHeaderEnvironments',
        allLabel: 'common.all',
        options: APP_ENVIRONMENTS.map((environment) => ({
          value: environment,
          label: environment,
          literal: true
        }))
      }
    ];

  readonly #list = bindListToUrl(this.#store);
  readonly sort = this.#list.sort;

  applyFilters(filters: FeatureFlagListQuery): void {
    this.#list.setFilters(filters);
  }

  sortData(sort: Sort): void {
    this.#list.setSort(sort.active, sort.direction);
  }

  readonly skeletonCells: readonly ListSkeletonCell[] = [
    'medium',
    'wide',
    'chip',
    'chip',
    'medium',
    'actions'
  ];

  readonly displayedColumns = [
    'key',
    'description',
    'environments',
    'public',
    'updatedAt',
    'actions'
  ];

  readonly canCreate = computed(() =>
    this.authStore.hasPermissions({ action: 'create', subject: 'FeatureFlag' })
  );
  canUpdate(flag: FeatureFlagResponse): boolean {
    return this.authStore.hasPermissions({
      action: 'update',
      subject: 'FeatureFlag',
      instance: flag
    });
  }

  canDelete(flag: FeatureFlagResponse): boolean {
    return this.authStore.hasPermissions({
      action: 'delete',
      subject: 'FeatureFlag',
      instance: flag
    });
  }

  openCreateDialog(): void {
    this.#openDialog({});
  }

  openEditDialog(flag: FeatureFlagResponse): void {
    this.#openDialog({ flag });
  }

  toggleFlag(flag: FeatureFlagResponse, change: MatSlideToggleChange): void {
    // The switch moves on click, before the write; put it back when the
    // write does not happen or fails.
    const revert = () => (change.source.checked = flag.enabled);
    if (!flag.enabled && !hasIncludeRule(flag.rules)) {
      confirmEnableForEveryone(this.#adaptiveDialog, this.#transloco, flag.key)
        .pipe(takeUntilDestroyed(this.#destroyRef))
        .subscribe((confirmed) => {
          if (confirmed) this.#applyToggle(flag, revert);
          else revert();
        });
      return;
    }
    this.#applyToggle(flag, revert);
  }

  #applyToggle(flag: FeatureFlagResponse, revert: () => void): void {
    // The target value is absolute and the write is conditional on the
    // version, so a stale row ends in a conflict instead of the wrong state.
    this.#store
      .updateFlag(flag.id, { enabled: !flag.enabled }, flag.version)
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
        error: (err: HttpErrorResponse) => {
          revert();
          this.#notify.error(err, 'admin.featureFlags.errorToggleFailed');
          if (
            err.error?.errorKey === ErrorKeys.FEATURE_FLAGS.VERSION_CONFLICT
          ) {
            this.#reloadFlag(flag.id);
          }
        }
      });
  }

  #reloadFlag(id: string): void {
    this.#store
      .reloadFlag(id)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        error: (err) => {
          this.#notify.error(err, 'admin.featureFlags.errorLoadFailed');
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
        viewContainerRef: this.#viewContainerRef,
        data
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((saved: FeatureFlagResponse | undefined) => {
        if (!saved) return;
        this.#notify.success(
          data.flag
            ? 'admin.featureFlags.successUpdated'
            : 'admin.featureFlags.successCreated',
          { key: saved.key }
        );
      });
  }
}
