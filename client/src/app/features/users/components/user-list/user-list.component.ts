import type { OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import type { Sort } from '@angular/material/sort';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMiniFabButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import type { PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import type { User, UserSortColumn } from '../../models/user.types';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { rem } from '@shared/utils/css.utils';
import { UsersStore } from '../../store/users.store';
import {
  COLUMN_TO_SORT_MAP,
  UserTableComponent
} from '../user-table/user-table.component';

@Component({
  selector: 'app-user-list',
  imports: [
    MatCard,
    MatCardHeader,
    MatIcon,
    MatCardContent,
    MatCardTitle,
    MatProgressSpinner,
    MatTooltip,
    MatMiniFabButton,
    RouterLink,
    UserTableComponent
  ],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserListComponent implements OnInit {
  readonly #usersStore = inject(UsersStore);
  readonly #snackBar = inject(MatSnackBar);
  readonly #dialog = inject(MatDialog);

  readonly loading = this.#usersStore.listLoading;
  readonly totalUsers = this.#usersStore.totalUsers;
  readonly pageSize = this.#usersStore.pageSize;
  readonly currentPage = this.#usersStore.currentPage;
  readonly displayedUsers = this.#usersStore.displayedUsers;

  ngOnInit(): void {
    this.#usersStore.loadAll();
  }

  handlePageEvent(event: PageEvent): void {
    if (event.pageSize !== this.#usersStore.pageSize()) {
      this.#usersStore.setPageSize(event.pageSize);
    } else {
      this.#usersStore.setPage(event.pageIndex);
    }
    this.#usersStore.loadAll();
  }

  sortData(sort: Sort): void {
    if (!sort.active || sort.direction === '') {
      this.#usersStore.setSorting('createdAt', 'desc');
    } else {
      const sortBy =
        (COLUMN_TO_SORT_MAP[sort.active] as UserSortColumn) ?? 'createdAt';
      this.#usersStore.setSorting(sortBy, sort.direction);
    }
    this.#usersStore.loadAll();
  }

  confirmDelete(user: User): void {
    const dialogRef = this.#dialog.open(ConfirmDialogComponent, {
      width: rem(350),
      data: {
        title: 'Confirm Delete',
        message: `Are you sure you want to delete user ${user.firstName} ${user.lastName}?`,
        confirmButton: 'Delete',
        cancelButton: 'Cancel'
      }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.deleteUser(user.id);
      }
    });
  }

  deleteUser(id: string): void {
    this.#usersStore.deleteUser(id).subscribe({
      next: () => {
        this.#snackBar.open('User deleted successfully', 'Close', {
          duration: 5000
        });
        this.#usersStore.loadAll();
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
}
