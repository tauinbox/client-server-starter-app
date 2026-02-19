import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import type {
  AbstractControl,
  FormControl,
  ValidationErrors
} from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';

type ResetPasswordFormType = {
  password: FormControl<string>;
  confirmPassword: FormControl<string>;
};

function passwordsMatchValidator(
  group: AbstractControl
): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return password === confirm ? null : { passwordsMismatch: true };
}

@Component({
  selector: 'app-reset-password',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatLabel,
    MatError,
    ReactiveFormsModule,
    MatFormField,
    MatInput,
    MatIcon,
    MatIconButton,
    MatButton,
    MatProgressSpinner,
    RouterLink
  ],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResetPasswordComponent implements OnInit {
  readonly #fb = inject(FormBuilder);
  readonly #authService = inject(AuthService);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);
  readonly #destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);
  protected readonly invalidToken = signal(false);

  #token = '';

  readonly resetPasswordForm = this.#fb.group<ResetPasswordFormType>(
    {
      password: this.#fb.control('', {
        validators: [Validators.required, Validators.minLength(8)],
        nonNullable: true
      }),
      confirmPassword: this.#fb.control('', {
        validators: [Validators.required],
        nonNullable: true
      })
    },
    { validators: [passwordsMatchValidator] }
  );

  ngOnInit(): void {
    this.#token = this.#route.snapshot.queryParams['token'] || '';

    if (!this.#token) {
      this.invalidToken.set(true);
      this.error.set('No reset token provided.');
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((prev) => !prev);
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((prev) => !prev);
  }

  onSubmit(): void {
    if (this.resetPasswordForm.invalid || !this.#token) return;

    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .resetPassword(this.#token, this.resetPasswordForm.getRawValue().password)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`]);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.error.set(
            err.error?.message ||
              'Password reset failed. The token may be invalid or expired.'
          );
        }
      });
  }
}
