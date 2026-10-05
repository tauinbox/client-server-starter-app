import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  ViewContainerRef
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
import { TranslocoDirective } from '@jsverse/transloco';
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
import type { ResourceResponse } from '@app/shared/types';
import type { ResourceListQuery } from '@app/shared/constants';
import {
  NxsListFiltersComponent,
  type ListFilterControl
} from '@shared/forms/nxs-list-filters/nxs-list-filters.component';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';
import { ResourcesStore } from '../../../store/resources.store';
import { InfiniteScrollDirective } from '@shared/directives/infinite-scroll.directive';
import { bindListToUrl } from '@shared/store/bind-list-to-url';
import {
  ListSkeletonComponent,
  type ListSkeletonCell
} from '@shared/components/list-skeleton/list-skeleton.component';
import type { ResourceFormDialogData } from '../resource-form-dialog/resource-form-dialog.component';
import { ResourceFormDialogComponent } from '../resource-form-dialog/resource-form-dialog.component';

@Component({
  selector: 'nxs-resource-list',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatIconButton,
    MatIcon,
    MatProgressSpinner,
    InfiniteScrollDirective,
    ListSkeletonComponent,
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
    MatSort,
    MatSortHeader,
    NxsListFiltersComponent,
    TranslocoDirective
  ],
  templateUrl: './resource-list.component.html',
  styleUrl: './resource-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResourceListComponent {
  readonly #resourcesStore = inject(ResourcesStore);
  readonly #dialog = inject(MatDialog);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #viewContainerRef = inject(ViewContainerRef);
  protected readonly authStore = inject(AuthStore);

  readonly loading = this.#resourcesStore.loading;
  readonly resources = this.#resourcesStore.resources;
  readonly hasMore = this.#resourcesStore.hasMore;
  readonly isLoadingMore = this.#resourcesStore.isLoadingMore;
  readonly busy = computed(
    () => this.#resourcesStore.loading() || this.#resourcesStore.isLoadingMore()
  );

  loadMore(): void {
    this.#resourcesStore.loadMore();
  }

  readonly filters = this.#resourcesStore.filters;

  readonly filterControls: readonly ListFilterControl<ResourceListQuery>[] = [
    {
      kind: 'select',
      key: 'isSystem',
      label: 'admin.roles.tableHeaderType',
      allLabel: 'common.all',
      options: [
        { value: true, label: 'admin.roles.typeSystem' },
        { value: false, label: 'admin.roles.typeCustom' }
      ]
    },
    {
      kind: 'select',
      key: 'isOrphaned',
      label: 'admin.resources.tableHeaderStatus',
      allLabel: 'common.all',
      options: [
        { value: false, label: 'common.active' },
        { value: true, label: 'admin.resources.statusOrphaned' }
      ]
    }
  ];

  readonly #list = bindListToUrl(this.#resourcesStore);
  readonly sort = this.#list.sort;

  applyFilters(filters: ResourceListQuery): void {
    this.#list.setFilters(filters);
  }

  sortData(sort: Sort): void {
    this.#list.setSort(sort.active, sort.direction);
  }

  readonly skeletonCells: readonly ListSkeletonCell[] = [
    'medium',
    'medium',
    'medium',
    'wide',
    'chip',
    'actions'
  ];

  readonly resourceColumns = [
    'displayName',
    'name',
    'subject',
    'description',
    'status',
    'actions'
  ];

  readonly canUpdate = computed(() =>
    this.authStore.hasPermissions({ action: 'update', subject: 'Permission' })
  );

  restoreResource(resource: ResourceResponse): void {
    this.#resourcesStore
      .restoreResource(resource.id)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#notify.success('admin.resources.successRestored', {
            name: resource.displayName
          });
        },
        error: (err) => {
          this.#notify.error(err, 'admin.resources.errorRestoreFailed');
        }
      });
  }

  openEditResource(resource: ResourceResponse): void {
    const data: ResourceFormDialogData = { resource };
    this.#dialog.open(ResourceFormDialogComponent, {
      ...dialogSizeConfig(DialogSize.Form),
      panelClass: 'app-dialog-tall',
      viewContainerRef: this.#viewContainerRef,
      data
    });
  }
}
