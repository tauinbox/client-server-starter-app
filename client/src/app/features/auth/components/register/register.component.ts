import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import type { FormControl, FormGroup } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { HttpErrorResponse } from '@angular/common/http';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type RegisterFormType = {
  email: FormControl<string>;
  firstName: FormControl<string>;
  lastName: FormControl<string>;
  password: FormControl<string>;
};

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
  readonly #fb = inject(FormBuilder);
  readonly #authService = inject(AuthService);
  readonly #router = inject(Router);
  readonly #snackBar = inject(MatSnackBar);
  readonly #destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  protected readonly appRouteSegmentEnum = AppRouteSegmentEnum;

  readonly registerForm: FormGroup<RegisterFormType> =
    this.#fb.group<RegisterFormType>({
      email: this.#fb.control('', {
        validators: [Validators.required, Validators.email],
        nonNullable: true
      }),
      firstName: this.#fb.control('', {
        validators: [Validators.required],
        nonNullable: true
      }),
      lastName: this.#fb.control('', {
        validators: [Validators.required],
        nonNullable: true
      }),
      password: this.#fb.control('', {
        validators: [Validators.required, Validators.minLength(8)],
        nonNullable: true
      })
    });

  togglePasswordVisibility(): void {
    this.showPassword.update((prev) => !prev);
  }

  onSubmit(): void {
    if (this.registerForm.invalid) return;

    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .register(this.registerForm.getRawValue())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.#snackBar.open(
            'Registration successful! Please login.',
            'Close',
            { duration: 5000 }
          );
          void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`]);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          if (err.status === 409) {
            this.error.set('User with this email already exists.');
          } else {
            this.error.set(
              err.error?.message || 'Registration failed. Please try again.'
            );
          }
        }
      });
  }
}
