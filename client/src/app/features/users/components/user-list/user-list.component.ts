import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
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
import type { Sort } from '@angular/material/sort';
import { MatSort } from '@angular/material/sort';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton, MatMiniFabButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { MatChip } from '@angular/material/chips';
import type { PageEvent } from '@angular/material/paginator';
import { MatPaginator } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import type { User } from '../../models/user.types';
import { DatePipe } from '@angular/common';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { rem } from '@shared/utils/css.utils';
import { UsersStore } from '../../store/users.store';

type SortableValue = string | number | boolean | Date;

@Component({
  selector: 'app-user-list',
  imports: [
    MatCard,
    MatCardHeader,
    MatIcon,
    MatCardContent,
    MatCardTitle,
    MatProgressSpinner,
    MatTable,
    MatSort,
    MatColumnDef,
    MatHeaderCell,
    MatHeaderCellDef,
    MatCell,
    MatCellDef,
    MatTooltip,
    MatMiniFabButton,
    RouterLink,
    MatChip,
    MatIconButton,
    MatHeaderRow,
    MatRow,
    MatHeaderRowDef,
    MatRowDef,
    MatPaginator,
    DatePipe
  ],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserListComponent implements OnInit {
  readonly #usersStore = inject(UsersStore);
  readonly #snackBar = inject(MatSnackBar);
  readonly #dialog = inject(MatDialog);

  readonly #sortState = signal<Sort>({ active: '', direction: '' });

  readonly loading = this.#usersStore.listLoading;
  readonly totalUsers = this.#usersStore.totalUsers;
  readonly pageSize = this.#usersStore.pageSize;
  readonly currentPage = this.#usersStore.currentPage;

  readonly displayedUsers = computed(() => {
    const sort = this.#sortState();
    const users = this.#usersStore.displayedUsers();

    if (!sort.active || sort.direction === '') {
      return users;
    }

    return [...users].sort((a, b) => {
      const isAsc = sort.direction === 'asc';
      switch (sort.active) {
        case 'id':
          return this.compare(a.id, b.id, isAsc);
        case 'email':
          return this.compare(a.email, b.email, isAsc);
        case 'name':
          return this.compare(
            a.firstName + a.lastName,
            b.firstName + b.lastName,
            isAsc
          );
        case 'status':
          return this.compare(a.isActive, b.isActive, isAsc);
        case 'role':
          return this.compare(a.isAdmin, b.isAdmin, isAsc);
        case 'createdAt':
          return this.compare(
            new Date(a.createdAt).getTime(),
            new Date(b.createdAt).getTime(),
            isAsc
          );
        default:
          return 0;
      }
    });
  });

  displayedColumns: string[] = [
    'id',
    'email',
    'name',
    'status',
    'role',
    'createdAt',
    'actions'
  ];

  ngOnInit(): void {
    this.#usersStore.loadAll();
  }

  handlePageEvent(event: PageEvent): void {
    this.#usersStore.setPageSize(event.pageSize);
    this.#usersStore.setPage(event.pageIndex);
  }

  sortData(sort: Sort): void {
    this.#sortState.set(sort);
  }

  compare<T extends SortableValue>(a: T, b: T, isAsc: boolean): number {
    return (a < b ? -1 : 1) * (isAsc ? 1 : -1);
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
