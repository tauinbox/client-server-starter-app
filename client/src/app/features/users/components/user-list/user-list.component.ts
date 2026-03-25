import type { AfterViewInit, ElementRef, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  Injector,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import type { FormControl, FormGroup } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import type { Sort } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { filter, merge } from 'rxjs';
import { NotificationsService } from '@core/services/notifications.service';
import type { User, UserSearch, UserSortColumn } from '../../models/user.types';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';
import { UsersStore } from '../../store/users.store';
import {
  COLUMN_TO_SORT_MAP,
  UserTableComponent
} from '../user-table/user-table.component';
import { AuthStore } from '../../../auth/store/auth.store';

type UserFilterFormType = {
  email: FormControl<string>;
  firstName: FormControl<string>;
  lastName: FormControl<string>;
  isActive: FormControl<string>;
};

@Component({
  selector: 'app-user-list',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatIcon,
    MatSelect,
    MatOption,
    MatButton,
    MatDivider,
    MatInput,
    MatProgressSpinner,
    UserTableComponent
  ],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserListComponent implements OnInit, AfterViewInit {
  readonly #fb = inject(FormBuilder);
  readonly #usersStore = inject(UsersStore);
  readonly #authStore = inject(AuthStore);
  readonly #snackBar = inject(MatSnackBar);
  readonly #dialog = inject(MatDialog);
  readonly #destroyRef = inject(DestroyRef);
  readonly #injector = inject(Injector);
  readonly #notificationsService = inject(NotificationsService);

  readonly filterForm: FormGroup<UserFilterFormType> =
    this.#fb.group<UserFilterFormType>({
      email: this.#fb.control('', { nonNullable: true }),
      firstName: this.#fb.control('', { nonNullable: true }),
      lastName: this.#fb.control('', { nonNullable: true }),
      isActive: this.#fb.control('', { nonNullable: true })
    });

  readonly canUpdate = computed(() =>
    this.#authStore.hasPermissions({ action: 'update', subject: 'User' })
  );
  readonly canDelete = computed(() =>
    this.#authStore.hasPermissions({ action: 'delete', subject: 'User' })
  );

  readonly loading = this.#usersStore.loading;
  readonly totalUsers = this.#usersStore.totalUsers;
  readonly displayedUsers = this.#usersStore.displayedUsers;
  readonly hasMore = this.#usersStore.hasMore;
  readonly isLoadingMore = this.#usersStore.isLoadingMore;

  readonly scrollSentinel = viewChild.required<ElementRef>('scrollSentinel');

  ngOnInit(): void {
    this.#usersStore.load();
    this.#notificationsService.userCrudEvents$
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe(() => {
        this.#usersStore.load();
      });
  }

  ngAfterViewInit(): void {
    const sentinel = this.scrollSentinel().nativeElement;

    const loadMoreIfVisible = () => {
      if (this.hasMore() && !this.isLoadingMore() && !this.loading()) {
        const rect = (sentinel as HTMLElement).getBoundingClientRect();
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

    observer.observe(sentinel);
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
    const filters = this.#buildFilters(this.filterForm.getRawValue());
    this.#usersStore.setFilters(filters);
    this.#usersStore.load();
  }

  resetForm(): void {
    this.filterForm.reset({
      email: '',
      firstName: '',
      lastName: '',
      isActive: ''
    });
    this.#usersStore.setFilters({});
    this.#usersStore.load();
  }

  confirmDelete(user: User): void {
    const dialogRef = this.#dialog.open(ConfirmDialogComponent, {
      ...dialogSizeConfig(DialogSize.Confirm),
      data: {
        title: 'Confirm Delete',
        message: `Are you sure you want to delete user ${user.firstName} ${user.lastName}?`,
        confirmButton: 'Delete',
        cancelButton: 'Cancel'
      }
    });

    dialogRef
      .afterClosed()
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
          this.#snackBar.open('User deleted successfully', 'Close', {
            duration: 5000
          });
        },
        error: () => {
          this.#snackBar.open(
            'Failed to delete user. Please try again.',
            'Close',
            { duration: 5000 }
          );
        }
      });
  }

  #buildFilters(
    formValues: FormGroup<UserFilterFormType>['value']
  ): UserSearch {
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
