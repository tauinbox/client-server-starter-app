import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatButton, MatIconButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { UserService } from '../../services/user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../../../auth/services/auth.service';
import { UpdateUser, User } from '../../models/user.types';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { HttpErrorResponse } from '@angular/common/http';

type UserFormType = {
  email: FormControl<string>;
  firstName: FormControl<string>;
  lastName: FormControl<string>;
  password: FormControl<string>;
  isAdmin: FormControl<boolean>;
  isActive: FormControl<boolean>;
};

@Component({
  selector: 'app-user-edit',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatLabel,
    MatError,
    MatIconButton,
    RouterLink,
    MatIcon,
    MatCardContent,
    MatProgressSpinner,
    ReactiveFormsModule,
    MatFormField,
    MatInput,
    MatCheckbox,
    MatButton
  ],
  templateUrl: './user-edit.component.html',
  styleUrl: './user-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserEditComponent implements OnInit {
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  authService = inject(AuthService);

  id = input.required<string>();
  user = signal<User | null>(null);
  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);
  showPassword = signal(false);

  userForm!: FormGroup<UserFormType>;

  ngOnInit(): void {
    this.initForm();
    this.loadUser();
  }

  private initForm(): void {
    this.userForm = this.fb.group<UserFormType>({
      email: this.fb.control('', {
        validators: [Validators.required, Validators.email],
        nonNullable: true
      }),
      firstName: this.fb.control('', {
        validators: [Validators.required],
        nonNullable: true
      }),
      lastName: this.fb.control('', {
        validators: [Validators.required],
        nonNullable: true
      }),
      password: this.fb.control('', {
        validators: [Validators.minLength(8)],
        nonNullable: true
      }),
      isAdmin: this.fb.control(false, { nonNullable: true }),
      isActive: this.fb.control(true, { nonNullable: true })
    });
  }

  loadUser(): void {
    this.loading.set(true);
    this.error.set(null);

    this.userService.getById(this.id()).subscribe({
      next: (user) => {
        this.user.set(user);

        this.userForm.patchValue({
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isAdmin: user.isAdmin,
          isActive: user.isActive,
          password: ''
        });

        this.userForm.markAsPristine();
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        const errorMessage =
          err.error?.message ||
          'Failed to load user details. Please try again.';
        this.error.set(errorMessage);
        this.snackBar.open(errorMessage, 'Close', {
          duration: 5000
        });
      }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((prev) => !prev);
  }

  onSubmit(): void {
    if (this.userForm.invalid || !this.user()) return;

    const formValues = this.userForm.getRawValue();
    const updateData: UpdateUser = {
      email: formValues.email,
      firstName: formValues.firstName,
      lastName: formValues.lastName
    };

    if (formValues.password.trim()) {
      updateData.password = formValues.password;
    }

    if (this.authService.isAdmin()) {
      updateData.isAdmin = formValues.isAdmin;
      updateData.isActive = formValues.isActive;
    }

    this.saving.set(true);
    this.error.set(null);

    this.userService.update(this.id(), updateData).subscribe({
      next: (updatedUser) => {
        this.saving.set(false);
        this.user.set(updatedUser);

        this.userForm.patchValue({ password: '' });
        this.userForm.markAsPristine();

        this.snackBar.open('User updated successfully', 'Close', {
          duration: 5000
        });

        void this.router.navigate(['/users', this.id()]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const errorMessage =
          err.error?.message || 'Failed to update user. Please try again.';
        this.error.set(errorMessage);
      }
    });
  }

  canDelete(): boolean {
    return (
      this.authService.isAdmin() && this.id() !== this.authService.user()?.id
    );
  }

  confirmDelete(): void {
    if (!this.user()) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '350px',
      data: {
        title: 'Confirm Delete',
        message: `Are you sure you want to delete user ${this.user()!.firstName} ${this.user()!.lastName}?`,
        confirmButton: 'Delete',
        cancelButton: 'Cancel',
        icon: 'warning'
      }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.deleteUser();
      }
    });
  }

  private deleteUser(): void {
    this.userService.delete(this.id()).subscribe({
      next: () => {
        this.snackBar.open('User deleted successfully', 'Close', {
          duration: 5000
        });
        void this.router.navigate(['/users']);
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
