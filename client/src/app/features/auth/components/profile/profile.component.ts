import {
  ChangeDetectionStrategy,
  Component,
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
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDivider } from '@angular/material/divider';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatButton, MatIconButton } from '@angular/material/button';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../../users/services/user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UpdateUser, User } from '../../../users/models/user.types';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';

type ProfileFormType = {
  firstName: FormControl<string>;
  lastName: FormControl<string>;
  password: FormControl<string>;
};

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

  profileForm!: FormGroup<ProfileFormType>;
  user = signal<User | null>(null);
  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);
  showPassword = signal(false);

  ngOnInit(): void {
    this.initForm();
    this.loadProfile();
  }

  private initForm(): void {
    this.profileForm = this.fb.group<ProfileFormType>({
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
      })
    });
  }

  loadProfile(): void {
    this.loading.set(true);
    this.error.set(null);

    this.authService.getProfile().subscribe({
      next: (user) => {
        this.user.set(user);
        this.profileForm.patchValue({
          firstName: user.firstName,
          lastName: user.lastName,
          password: ''
        });
        this.loading.set(false);
        this.profileForm.markAsPristine();
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        const errorMessage =
          err.error?.message || 'Failed to load profile. Please try again.';
        this.error.set(errorMessage);
      }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((prev) => !prev);
  }

  onSubmit(): void {
    if (this.profileForm.invalid || !this.user()) return;

    const formValues = this.profileForm.getRawValue();

    const updateData: UpdateUser = {
      firstName: formValues.firstName,
      lastName: formValues.lastName
    };

    if (formValues.password.trim()) {
      updateData.password = formValues.password;
    }

    this.saving.set(true);
    this.error.set(null);

    this.userService.update(this.user()!.id, updateData).subscribe({
      next: (updatedUser) => {
        this.saving.set(false);
        this.user.set(updatedUser);

        this.profileForm.patchValue({ password: '' });
        this.profileForm.markAsPristine();

        this.snackBar.open('Profile updated successfully', 'Close', {
          duration: 5000
        });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const errorMessage =
          err.error?.message || 'Failed to update profile. Please try again.';
        this.error.set(errorMessage);
      }
    });
  }
}
