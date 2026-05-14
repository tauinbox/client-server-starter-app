import type { ElementRef, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { form } from '@angular/forms/signals';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import type { Sort } from '@angular/material/sort';
import { filter, merge } from 'rxjs';
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
import { AppFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';

type FilterModel = {
  email: string;
  firstName: string;
  lastName: string;
  isActive: string;
};

const INITIAL_FILTER: FilterModel = {
  email: '',
  firstName: '',
  lastName: '',
  isActive: ''
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
    MatDivider,
    MatProgressSpinner,
    UserTableComponent,
    UserCardListComponent,
    TranslocoDirective,
    AppFormFieldComponent
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
  readonly #injector = inject(Injector);
  readonly #notificationsService = inject(NotificationsService);
  readonly #translocoService = inject(TranslocoService);

  readonly layout = inject(LayoutService);

  readonly filterModel = signal<FilterModel>({ ...INITIAL_FILTER });
  readonly filterForm = form(this.filterModel);

  readonly isActiveFilter = signal('');

  readonly loading = this.#usersStore.loading;
  readonly totalUsers = this.#usersStore.totalUsers;
  readonly displayedUsers = this.#usersStore.displayedUsers;
  readonly hasMore = this.#usersStore.hasMore;
  readonly isLoadingMore = this.#usersStore.isLoadingMore;

  readonly scrollSentinel = viewChild<ElementRef>('scrollSentinel');

  constructor() {
    // Set up IntersectionObserver reactively: the sentinel lives inside a
    // *transloco structural directive, so it only appears in the DOM after
    // translations load. The effect re-runs when the signal becomes non-null.
    let observerAttached = false;
    effect(() => {
      const sentinelEl = this.scrollSentinel()?.nativeElement as
        | HTMLElement
        | undefined;
      if (!sentinelEl || observerAttached) return;
      observerAttached = true;

      untracked(() => {
        const loadMoreIfVisible = () => {
          if (this.hasMore() && !this.isLoadingMore() && !this.loading()) {
            const rect = sentinelEl.getBoundingClientRect();
            if (rect.top <= window.innerHeight) {
              this.#usersStore.loadMore();
            }
          }
        };

        const observer = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) loadMoreIfVisible();
          },
          { threshold: 0 }
        );

        observer.observe(sentinelEl);
        this.#destroyRef.onDestroy(() => observer.disconnect());

        merge(
          toObservable(this.loading, { injector: this.#injector }),
          toObservable(this.isLoadingMore, { injector: this.#injector })
        )
          .pipe(
            filter((isLoading) => !isLoading),
            takeUntilDestroyed(this.#destroyRef)
          )
          .subscribe(() => loadMoreIfVisible());
      });
    });
  }

  ngOnInit(): void {
    this.#usersStore.load();
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
    const formValues = this.filterModel();
    const filters = this.#buildFilters({
      ...formValues,
      isActive: this.isActiveFilter()
    });
    this.#usersStore.setFilters(filters);
    this.#usersStore.load();
  }

  resetForm(): void {
    this.filterModel.set({ ...INITIAL_FILTER });
    this.isActiveFilter.set('');
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

  #buildFilters(formValues: FilterModel): UserSearch {
    const filters: UserSearch = {};

    if (formValues.email?.trim()) filters.email = formValues.email;
    if (formValues.firstName?.trim()) filters.firstName = formValues.firstName;
    if (formValues.lastName?.trim()) filters.lastName = formValues.lastName;

    if (formValues.isActive !== '') {
      filters.isActive = formValues.isActive === 'true';
    }

    return filters;
  }
}
