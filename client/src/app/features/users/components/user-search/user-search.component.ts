import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import type { Sort } from '@angular/material/sort';
import type { PageEvent } from '@angular/material/paginator';
import type { User, UserSearch, UserSortColumn } from '../../models/user.types';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { rem } from '@shared/utils/css.utils';
import { UsersStore } from '../../store/users.store';
import {
  COLUMN_TO_SORT_MAP,
  UserTableComponent
} from '../user-table/user-table.component';

type UserSearchFormType = {
  email: FormControl<string>;
  firstName: FormControl<string>;
  lastName: FormControl<string>;
  isActive: FormControl<string>;
};

@Component({
  selector: 'app-user-search',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    ReactiveFormsModule,
    MatFormField,
    MatIcon,
    MatSelect,
    MatOption,
    MatButton,
    MatDivider,
    MatInput,
    MatLabel,
    UserTableComponent
  ],
  templateUrl: './user-search.component.html',
  styleUrl: './user-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserSearchComponent {
  readonly #fb = inject(FormBuilder);
  readonly #usersStore = inject(UsersStore);
  readonly #snackBar = inject(MatSnackBar);
  readonly #dialog = inject(MatDialog);
  readonly #destroyRef = inject(DestroyRef);

  readonly searchForm: FormGroup<UserSearchFormType> =
    this.#fb.group<UserSearchFormType>({
      email: this.#fb.control('', { nonNullable: true }),
      firstName: this.#fb.control('', { nonNullable: true }),
      lastName: this.#fb.control('', { nonNullable: true }),
      isActive: this.#fb.control('', { nonNullable: true })
    });

  readonly users = this.#usersStore.searchResultUsers;
  readonly searching = this.#usersStore.searchLoading;
  readonly searched = this.#usersStore.searchPerformed;
  readonly searchTotalUsers = this.#usersStore.searchTotalUsers;
  readonly searchCurrentPage = this.#usersStore.searchCurrentPage;
  readonly searchPageSize = this.#usersStore.searchPageSize;

  onSubmit(): void {
    const formValues = this.searchForm.getRawValue();
    const criteria = this.#buildSearchCriteria(formValues);
    this.#usersStore.setSearchPage(0);
    this.#usersStore.search(criteria);
  }

  #buildSearchCriteria(
    formValues: FormGroup<UserSearchFormType>['value']
  ): UserSearch {
    const criteria: UserSearch = {};

    if (formValues.email?.trim()) criteria.email = formValues.email;
    if (formValues.firstName?.trim()) criteria.firstName = formValues.firstName;
    if (formValues.lastName?.trim()) criteria.lastName = formValues.lastName;

    if (formValues.isActive !== '') {
      criteria.isActive = formValues.isActive === 'true';
    }

    return criteria;
  }

  handleSearchPageEvent(event: PageEvent): void {
    if (event.pageSize !== this.#usersStore.searchPageSize()) {
      this.#usersStore.setSearchPageSize(event.pageSize);
    } else {
      this.#usersStore.setSearchPage(event.pageIndex);
    }
    this.#reSearch();
  }

  searchSortData(sort: Sort): void {
    if (!sort.active || sort.direction === '') {
      this.#usersStore.setSearchSorting('createdAt', 'desc');
    } else {
      const sortBy =
        (COLUMN_TO_SORT_MAP[sort.active] as UserSortColumn) ?? 'createdAt';
      this.#usersStore.setSearchSorting(sortBy, sort.direction);
    }
    this.#reSearch();
  }

  resetForm(): void {
    this.searchForm.reset({
      email: '',
      firstName: '',
      lastName: '',
      isActive: ''
    });

    this.#usersStore.clearSearch();
  }

  confirmDelete(user: User): void {
    const dialogRef = this.#dialog.open(ConfirmDialogComponent, {
      width: rem(350),
      data: {
        title: 'Confirm Delete',
        message: `Are you sure you want to delete user ${user.firstName} ${user.lastName}?`,
        confirmButton: 'Delete',
        cancelButton: 'Cancel',
        icon: 'warning'
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
          this.#reSearch();
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

  #reSearch(): void {
    const criteria = this.#usersStore.lastSearchCriteria();
    if (criteria) {
      this.#usersStore.search(criteria);
    }
  }
}
