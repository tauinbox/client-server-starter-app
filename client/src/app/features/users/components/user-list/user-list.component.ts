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
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { form, maxLength } from '@angular/forms/signals';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
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
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import { InfiniteScrollDirective } from '@shared/directives/infinite-scroll.directive';
import { RoleCatalogService } from '@core/services/role-catalog.service';
import type { RoleAdminResponse } from '@app/shared/types';
import { MAX_USER_FILTER_LENGTH } from '@app/shared/constants';

type FilterModel = {
  q: string;
};

const INITIAL_FILTER: FilterModel = {
  q: ''
};

@Component({
  selector: 'nxs-user-list',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatFormField,
    MatLabel,
    MatIcon,
    MatSelect,
    MatOption,
    MatButton,
    MatCheckbox,
    MatDivider,
    MatProgressSpinner,
    UserTableComponent,
    UserCardListComponent,
    TranslocoDirective,
    NxsFormFieldComponent,
    InfiniteScrollDirective
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

  readonly filterModel = signal<FilterModel>({ ...INITIAL_FILTER });
  readonly filterForm = form(this.filterModel, (path) => {
    maxLength(path.q, MAX_USER_FILTER_LENGTH);
  });

  readonly isActiveFilter = signal('');
  readonly roleFilter = signal('');
  readonly includeDeletedFilter = signal(false);
  readonly roles = signal<RoleAdminResponse[]>([]);

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
      .pipe(takeUntilDestroyed(this.#destroyRef))
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

  onSubmit(): void {
    if (this.filterForm().invalid()) return;

    const filters: UserSearch = {};

    const q = this.filterModel().q.trim();
    if (q) filters.q = q;

    const role = this.roleFilter();
    if (role) filters.role = role;

    const isActive = this.isActiveFilter();
    if (isActive !== '') filters.isActive = isActive === 'true';

    if (this.includeDeletedFilter()) filters.includeDeleted = true;

    this.#usersStore.setFilters(filters);
    this.#usersStore.load();
  }

  resetForm(): void {
    this.filterModel.set({ ...INITIAL_FILTER });
    this.isActiveFilter.set('');
    this.roleFilter.set('');
    this.includeDeletedFilter.set(false);
    this.filterForm().reset();
    this.#usersStore.setFilters({});
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
