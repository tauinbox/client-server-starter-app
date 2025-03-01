import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatCard, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDivider } from '@angular/material/divider';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatButton, MatIconButton } from '@angular/material/button';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../../users/services/user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '../../../users/models/user.types';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-profile',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatError,
    MatLabel,
    MatProgressSpinner,
    MatDivider,
    ReactiveFormsModule,
    MatFormField,
    MatIcon,
    MatInput,
    MatIconButton,
    MatButton,
    DatePipe
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProfileComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private snackBar = inject(MatSnackBar);

  profileForm: FormGroup;
  user = signal<User | null>(null);
  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);
  showPassword = signal(false);

  constructor() {
    this.profileForm = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      password: ['', [Validators.minLength(8)]]
    });
  }

  ngOnInit(): void {
    this.loadProfile();
  }

  loadProfile(): void {
    this.loading.set(true);

    this.authService.getProfile().subscribe({
      next: (user) => {
        this.user.set(user);
        this.profileForm.patchValue({
          firstName: user.firstName,
          lastName: user.lastName
        });
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Failed to load profile. Please try again.');
      }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(prev => !prev);
  }

  onSubmit(): void {
    if (this.profileForm.invalid || !this.user()) return;

    // Only include password in update if it was provided
    const updateData = {
      firstName: this.profileForm.value.firstName,
      lastName: this.profileForm.value.lastName,
      ...(this.profileForm.value.password ? { password: this.profileForm.value.password } : {})
    };

    this.saving.set(true);
    this.error.set(null);

    this.userService.update(this.user()!.id, updateData).subscribe({
      next: (updatedUser) => {
        this.saving.set(false);
        this.user.set(updatedUser);

        // Reset password field
        this.profileForm.patchValue({ password: '' });
        this.profileForm.markAsPristine();

        this.snackBar.open('Profile updated successfully', 'Close', {
          duration: 5000
        });
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err.message || 'Failed to update profile. Please try again.');
      }
    });
  }
}
