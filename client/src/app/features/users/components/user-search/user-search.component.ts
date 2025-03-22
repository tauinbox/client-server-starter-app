import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule
} from '@angular/forms';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
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
import { MatTooltip } from '@angular/material/tooltip';
import { MatChip } from '@angular/material/chips';
import { RouterLink } from '@angular/router';
import { MatInput } from '@angular/material/input';
import { UserService } from '../../services/user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { User, UserSearch } from '../../models/user.types';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';

type UserSearchFormType = {
  email: FormControl<string>;
  firstName: FormControl<string>;
  lastName: FormControl<string>;
  isAdmin: FormControl<string>;
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
    MatTable,
    MatColumnDef,
    MatHeaderCell,
    MatCell,
    MatCellDef,
    MatHeaderCellDef,
    MatTooltip,
    MatChip,
    MatIconButton,
    RouterLink,
    MatHeaderRow,
    MatRow,
    MatHeaderRowDef,
    MatRowDef,
    MatInput,
    MatLabel,
    DatePipe
  ],
  templateUrl: './user-search.component.html',
  styleUrl: './user-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserSearchComponent implements OnInit {
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  searchForm!: FormGroup<UserSearchFormType>;
  users = signal<User[]>([]);
  searching = signal(false);
  searched = signal(false);

  resultsFound = computed(() => this.users().length > 0);

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
    this.initForm();
  }

  private initForm(): void {
    this.searchForm = this.fb.group<UserSearchFormType>({
      email: this.fb.control('', { nonNullable: true }),
      firstName: this.fb.control('', { nonNullable: true }),
      lastName: this.fb.control('', { nonNullable: true }),
      isAdmin: this.fb.control('', { nonNullable: true }),
      isActive: this.fb.control('', { nonNullable: true })
    });
  }

  onSubmit(): void {
    const formValues = this.searchForm.getRawValue();
    const criteria = this.buildSearchCriteria(formValues);

    this.searching.set(true);
    this.searched.set(false);

    this.userService.search(criteria).subscribe({
      next: (users) => {
        this.users.set(users);
        this.searching.set(false);
        this.searched.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.searching.set(false);
        const errorMessage =
          err.error?.message || 'Failed to search users. Please try again.';
        this.snackBar.open(errorMessage, 'Close', {
          duration: 5000
        });
      }
    });
  }

  private buildSearchCriteria(
    formValues: FormGroup<UserSearchFormType>['value']
  ): UserSearch {
    const criteria: UserSearch = {};

    if (formValues.email?.trim()) criteria.email = formValues.email;
    if (formValues.firstName?.trim()) criteria.firstName = formValues.firstName;
    if (formValues.lastName?.trim()) criteria.lastName = formValues.lastName;

    if (formValues.isAdmin !== '') {
      criteria.isAdmin = formValues.isAdmin === 'true';
    }

    if (formValues.isActive !== '') {
      criteria.isActive = formValues.isActive === 'true';
    }

    return criteria;
  }

  resetForm(): void {
    this.searchForm.reset({
      email: '',
      firstName: '',
      lastName: '',
      isAdmin: '',
      isActive: ''
    });

    this.users.set([]);
    this.searched.set(false);
  }

  confirmDelete(user: User): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '350px',
      data: {
        title: 'Confirm Delete',
        message: `Are you sure you want to delete user ${user.firstName} ${user.lastName}?`,
        confirmButton: 'Delete',
        cancelButton: 'Cancel',
        icon: 'warning'
      }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.deleteUser(user.id);
      }
    });
  }

  private deleteUser(id: string): void {
    this.userService.delete(id).subscribe({
      next: () => {
        this.users.update((users) => users.filter((user) => user.id !== id));

        this.snackBar.open('User deleted successfully', 'Close', {
          duration: 5000
        });
      },
      error: (err: HttpErrorResponse) => {
        const errorMessage =
          err.error?.message || 'Failed to delete user. Please try again.';
        this.snackBar.open(errorMessage, 'Close', {
          duration: 5000
        });
      }
    });
  }
}
