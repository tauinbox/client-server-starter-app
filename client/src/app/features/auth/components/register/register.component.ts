import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardActions,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-register',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatLabel,
    MatFormField,
    ReactiveFormsModule,
    MatInput,
    MatIcon,
    MatIconButton,
    MatButton,
    MatError,
    MatProgressSpinner,
    MatCardActions,
    RouterLink
  ],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  registerForm: FormGroup;
  loading = signal(false);
  error = signal<string | null>(null);
  showPassword = signal(false);

  constructor() {
    this.registerForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(8)]]
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((prev) => !prev);
  }

  onSubmit(): void {
    if (this.registerForm.invalid) return;

    this.loading.set(true);
    this.error.set(null);

    this.authService.register(this.registerForm.value).subscribe({
      next: () => {
        this.loading.set(false);
        this.snackBar.open('Registration successful! Please login.', 'Close', {
          duration: 5000
        });
        this.router.navigate(['/login']);
      },
      error: (err) => {
        this.loading.set(false);
        if (err.status === 409) {
          this.error.set('User with this email already exists.');
        } else {
          this.error.set(
            err.message || 'Registration failed. Please try again.'
          );
        }
      }
    });
  }
}
