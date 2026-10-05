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
import { catchError, of } from 'rxjs';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatDivider } from '@angular/material/divider';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import type { Sort } from '@angular/material/sort';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { LayoutService } from '@core/services/layout.service';
import { NotificationsService } from '@core/services/notifications.service';
import { NotifyService } from '@core/services/notify.service';
import type { User, UserSearch, UserSortColumn } from '../../models/user.types';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { UsersStore } from '../../store/users.store';
import {
  COLUMN_TO_SORT_MAP,
  UserTableComponent
} from '../user-table/user-table.component';
import { UserCardListComponent } from '../user-card-list/user-card-list.component';
import {
  NxsListFiltersComponent,
  type ListFilterControl
} from '@shared/forms/nxs-list-filters/nxs-list-filters.component';
import { InfiniteScrollDirective } from '@shared/directives/infinite-scroll.directive';
import {
  ListSkeletonComponent,
  type ListSkeletonCell
} from '@shared/components/list-skeleton/list-skeleton.component';
import { RoleCatalogService } from '@core/services/role-catalog.service';
import type { RoleAdminResponse } from '@app/shared/types';

@Component({
  selector: 'nxs-user-list',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatIcon,
    MatDivider,
    MatProgressSpinner,
    UserTableComponent,
    UserCardListComponent,
    TranslocoDirective,
    NxsListFiltersComponent,
    InfiniteScrollDirective,
    ListSkeletonComponent
  ],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserListComponent implements OnInit {
  readonly #usersStore = inject(UsersStore);
  readonly #notify = inject(NotifyService);
  readonly #adaptiveDialog = inject(AdaptiveDialogService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #notificationsService = inject(NotificationsService);
  readonly #translocoService = inject(TranslocoService);
  readonly #roleCatalog = inject(RoleCatalogService);

  readonly layout = inject(LayoutService);

  readonly roles = signal<RoleAdminResponse[]>([]);
  readonly filters = this.#usersStore.filters;

  readonly filterControls = computed<readonly ListFilterControl<UserSearch>[]>(
    () => [
      {
        kind: 'select',
        key: 'role',
        label: 'users.list.filterRole',
        allLabel: 'users.list.roleAll',
        options: this.roles().map((role) => ({
          value: role.name,
          label: role.name,
          literal: true
        }))
      },
      {
        kind: 'select',
        key: 'isActive',
        label: 'users.list.filterStatus',
        allLabel: 'users.list.statusAll',
        options: [
          { value: true, label: 'common.active' },
          { value: false, label: 'common.inactive' }
        ]
      },
      {
        kind: 'select',
        key: 'isEmailVerified',
        label: 'users.list.filterEmail',
        allLabel: 'users.list.statusAll',
        options: [
          { value: true, label: 'users.list.emailVerified' },
          { value: false, label: 'users.list.emailNotVerified' }
        ]
      },
      {
        kind: 'select',
        key: 'mfaEnabled',
        label: 'users.list.filterMfa',
        allLabel: 'users.list.statusAll',
        options: [
          { value: true, label: 'users.list.mfaOn' },
          { value: false, label: 'users.list.mfaOff' }
        ]
      },
      {
        kind: 'select',
        key: 'isLocked',
        label: 'users.list.filterLock',
        allLabel: 'users.list.statusAll',
        options: [
          { value: true, label: 'users.list.locked' },
          { value: false, label: 'users.list.notLocked' }
        ]
      },
      {
        kind: 'select',
        key: 'hasPassword',
        label: 'users.list.filterSignIn',
        allLabel: 'users.list.statusAll',
        options: [
          { value: true, label: 'users.list.signInPassword' },
          { value: false, label: 'users.list.signInOAuthOnly' }
        ]
      },
      {
        kind: 'checkbox',
        key: 'includeDeleted',
        label: 'users.list.filterIncludeDeleted'
      }
    ]
  );

  readonly skeletonCells: readonly ListSkeletonCell[] = [
    'narrow',
    'wide',
    'medium',
    'chip',
    'chip',
    'medium',
    'actions'
  ];

  readonly loading = this.#usersStore.loading;
  readonly displayedUsers = this.#usersStore.displayedUsers;
  readonly hasMore = this.#usersStore.hasMore;
  readonly isLoadingMore = this.#usersStore.isLoadingMore;
  readonly busy = computed(
    () => this.#usersStore.loading() || this.#usersStore.isLoadingMore()
  );

  loadMore(): void {
    this.#usersStore.loadMore();
  }

  ngOnInit(): void {
    this.#usersStore.load();
    this.#roleCatalog
      .getAll()
      .pipe(
        catchError(() => of([])),
        takeUntilDestroyed(this.#destroyRef)
      )
      .subscribe((roles) => this.roles.set(roles));
    this.#notificationsService.userCrudEvents$
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe(() => {
        this.#usersStore.load();
      });
  }

  sortData(sort: Sort): void {
    if (!sort.active || sort.direction === '') {
      this.#usersStore.setSorting('createdAt', 'desc');
    } else {
      const sortBy =
        (COLUMN_TO_SORT_MAP[sort.active] as UserSortColumn) ?? 'createdAt';
      this.#usersStore.setSorting(sortBy, sort.direction);
    }
    this.#usersStore.load();
  }

  applyFilters(filters: UserSearch): void {
    this.#usersStore.setFilters(filters);
    this.#usersStore.load();
  }

  confirmDelete(user: User): void {
    this.#adaptiveDialog
      .openConfirm({
        title: this.#translocoService.translate(
          'users.list.confirmDeleteTitle'
        ),
        message: this.#translocoService.translate(
          'users.list.confirmDeleteMessage',
          { firstName: user.firstName, lastName: user.lastName }
        ),
        confirmButton: this.#translocoService.translate('common.delete'),
        cancelButton: this.#translocoService.translate('common.cancel')
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result) => {
        if (result) {
          this.#deleteUser(user.id);
        }
      });
  }

  confirmRestore(user: User): void {
    this.#adaptiveDialog
      .openConfirm({
        title: this.#translocoService.translate(
          'users.list.confirmRestoreTitle'
        ),
        message: this.#translocoService.translate(
          'users.list.confirmRestoreMessage',
          { firstName: user.firstName, lastName: user.lastName }
        ),
        confirmButton: this.#translocoService.translate(
          'users.list.actionRestore'
        ),
        cancelButton: this.#translocoService.translate('common.cancel')
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result) => {
        if (result) {
          this.#restoreUser(user.id);
        }
      });
  }

  #restoreUser(id: string): void {
    this.#usersStore
      .restoreUser(id)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#notify.success('users.list.successRestored');
        },
        error: () => {
          this.#notify.error('users.list.errorRestoreFailed');
        }
      });
  }

  #deleteUser(id: string): void {
    this.#usersStore
      .deleteUser(id)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#notify.success('users.list.successDeleted');
        },
        error: () => {
          this.#notify.error('users.list.errorDeleteFailed');
        }
      });
  }
}
