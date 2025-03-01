import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { MatCard, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import { MatButton, MatIconButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { NgIf } from '@angular/common';
import { UserService } from '../../services/user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../../../auth/services/auth.service';
import { User } from '../../models/user.types';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';

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
    MatButton,
    NgIf
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

  userForm: FormGroup;

  constructor() {
    this.userForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      password: ['', [Validators.minLength(8)]],
      isAdmin: [false],
      isActive: [true]
    });
  }

  ngOnInit(): void {
    this.loadUser();
  }

  loadUser(): void {
    this.loading.set(true);

    this.userService.getById(this.id()).subscribe({
      next: (user) => {
        this.user.set(user);

        this.userForm.patchValue({
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isAdmin: user.isAdmin,
          isActive: user.isActive
        });

        // Reset form state after patching values
        this.userForm.markAsPristine();
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Failed to load user details. Please try again.', 'Close', {
          duration: 5000
        });
      }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(prev => !prev);
  }

  onSubmit(): void {
    if (this.userForm.invalid || !this.user()) return;

    // Only include password in update if it was provided
    const updateData: any = {
      email: this.userForm.value.email,
      firstName: this.userForm.value.firstName,
      lastName: this.userForm.value.lastName,
      ...(this.userForm.value.password ? { password: this.userForm.value.password } : {})
    };

    // Only include admin fields if user is an admin
    if (this.authService.isAdmin()) {
      updateData['isAdmin'] = this.userForm.value.isAdmin;
      updateData['isActive'] = this.userForm.value.isActive;
    }

    this.saving.set(true);
    this.error.set(null);

    this.userService.update(this.id(), updateData).subscribe({
      next: (updatedUser) => {
        this.saving.set(false);
        this.user.set(updatedUser);

        // Reset password field
        this.userForm.patchValue({ password: '' });
        this.userForm.markAsPristine();

        this.snackBar.open('User updated successfully', 'Close', {
          duration: 5000
        });

        // Navigate back to user details
        this.router.navigate(['/users', this.id()]);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err.message || 'Failed to update user. Please try again.');
      }
    });
  }

  canDelete(): boolean {
    // Check if user is admin and not editing themselves
    return this.authService.isAdmin() && this.id() !== this.authService.user()?.id;
  }

  confirmDelete(): void {
    if (!this.user()) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '350px',
      data: {
        title: 'Confirm Delete',
        message: `Are you sure you want to delete user ${this.user()!.firstName} ${this.user()!.lastName}?`,
        confirmButton: 'Delete',
        cancelButton: 'Cancel'
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.deleteUser();
      }
    });
  }

  deleteUser(): void {
    this.userService.delete(this.id()).subscribe({
      next: () => {
        this.snackBar.open('User deleted successfully', 'Close', {
          duration: 5000
        });

        // Navigate back to user list
        this.router.navigate(['/users']);
      },
      error: () => {
        this.snackBar.open('Failed to delete user. Please try again.', 'Close', {
          duration: 5000
        });
      }
    });
  }
}
