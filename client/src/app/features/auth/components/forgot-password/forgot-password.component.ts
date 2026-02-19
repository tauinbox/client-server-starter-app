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
import type { FormControl } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type ForgotPasswordFormType = {
  email: FormControl<string>;
};

@Component({
  selector: 'app-forgot-password',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatCardActions,
    MatLabel,
    MatError,
    ReactiveFormsModule,
    MatFormField,
    MatInput,
    MatIcon,
    MatButton,
    MatProgressSpinner,
    RouterLink
  ],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ForgotPasswordComponent {
  readonly #fb = inject(FormBuilder);
  readonly #authService = inject(AuthService);
  readonly #destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly success = signal(false);
  protected readonly error = signal<string | null>(null);

  readonly forgotPasswordForm = this.#fb.group<ForgotPasswordFormType>({
    email: this.#fb.control('', {
      validators: [Validators.required, Validators.email],
      nonNullable: true
    })
  });

  onSubmit(): void {
    if (this.forgotPasswordForm.invalid) return;

    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .forgotPassword(this.forgotPasswordForm.getRawValue().email)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.success.set(true);
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Something went wrong. Please try again later.');
        }
      });
  }
}
