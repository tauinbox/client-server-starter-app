import type { AfterViewInit, ElementRef, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
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
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import type { Sort } from '@angular/material/sort';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMiniFabButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { filter, merge } from 'rxjs';
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
  readonly #injector = inject(Injector);

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

    // Re-check sentinel visibility after each load completes so that
    // additional pages are fetched when the initial batch fills the viewport.
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
