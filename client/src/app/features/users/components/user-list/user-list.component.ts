import type { AfterViewInit, ElementRef, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
export class UserListComponent implements OnInit, AfterViewInit {
  readonly #usersStore = inject(UsersStore);
  readonly #snackBar = inject(MatSnackBar);
  readonly #dialog = inject(MatDialog);
  readonly #destroyRef = inject(DestroyRef);

  readonly loading = this.#usersStore.listLoading;
  readonly totalUsers = this.#usersStore.totalUsers;
  readonly displayedUsers = this.#usersStore.displayedUsers;
  readonly hasMore = this.#usersStore.hasMore;
  readonly isLoadingMore = this.#usersStore.isLoadingMore;

  readonly scrollSentinel = viewChild.required<ElementRef>('scrollSentinel');

  ngOnInit(): void {
    this.#usersStore.loadAll();
  }

  ngAfterViewInit(): void {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry.isIntersecting &&
          this.hasMore() &&
          !this.isLoadingMore() &&
          !this.loading()
        ) {
          this.#usersStore.loadMore();
        }
      },
      { threshold: 0 }
    );

    observer.observe(this.scrollSentinel().nativeElement);
    this.#destroyRef.onDestroy(() => observer.disconnect());
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

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result) => {
        if (result) {
          this.deleteUser(user.id);
        }
      });
  }

  deleteUser(id: string): void {
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
}
