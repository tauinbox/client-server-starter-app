import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
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
    MatProgressSpinner,
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
    MatIcon,
    DatePipe
  ],
  templateUrl: './user-search.component.html',
  styleUrl: './user-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserSearchComponent {
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  searchForm: FormGroup;
  users = signal<User[]>([]);
  searching = signal(false);
  searched = signal(false);

  displayedColumns: string[] = [
    'id',
    'email',
    'name',
    'status',
    'role',
    'createdAt',
    'actions'
  ];

  constructor() {
    this.searchForm = this.fb.group({
      email: [''],
      firstName: [''],
      lastName: [''],
      isAdmin: [''],
      isActive: ['']
    });
  }

  onSubmit(): void {
    const criteria: UserSearch = {};

    // Only include non-empty fields in the search criteria
    const formValue = this.searchForm.value;

    if (formValue.email) criteria.email = formValue.email;
    if (formValue.firstName) criteria.firstName = formValue.firstName;
    if (formValue.lastName) criteria.lastName = formValue.lastName;

    // Handle boolean values (convert from string if needed)
    if (formValue.isAdmin !== '') {
      criteria.isAdmin =
        formValue.isAdmin === 'true' || formValue.isAdmin === true;
    }

    if (formValue.isActive !== '') {
      criteria.isActive =
        formValue.isActive === 'true' || formValue.isActive === true;
    }

    this.searching.set(true);

    this.userService.search(criteria).subscribe({
      next: (users) => {
        this.users.set(users);
        this.searching.set(false);
        this.searched.set(true);
      },
      error: () => {
        this.searching.set(false);
        this.snackBar.open(
          'Failed to search users. Please try again.',
          'Close',
          {
            duration: 5000
          }
        );
      }
    });
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
    this.userService.delete(id).subscribe({
      next: () => {
        this.users.update((users) => users.filter((user) => user.id !== id));

        this.snackBar.open('User deleted successfully', 'Close', {
          duration: 5000
        });
      },
      error: () => {
        this.snackBar.open(
          'Failed to delete user. Please try again.',
          'Close',
          {
            duration: 5000
          }
        );
      }
    });
  }
}
