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
import { form, minLength, required, validate } from '@angular/forms/signals';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { AppFormFieldComponent } from '@shared/forms/app-form-field/app-form-field.component';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

type ResetPasswordData = {
  password: string;
  confirmPassword: string;
};

@Component({
  selector: 'app-reset-password',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatIcon,
    MatButton,
    MatProgressSpinner,
    RouterLink,
    PasswordToggleComponent,
    AppFormFieldComponent,
    TranslocoDirective
  ],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResetPasswordComponent implements OnInit {
  readonly #authService = inject(AuthService);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);
  readonly #destroyRef = inject(DestroyRef);
  readonly #translocoService = inject(TranslocoService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly invalidToken = signal(false);

  #token = '';

  readonly resetPasswordModel = signal<ResetPasswordData>({
    password: '',
    confirmPassword: ''
  });

  readonly resetPasswordForm = form(this.resetPasswordModel, (path) => {
    required(path.password, {
      message: 'auth.resetPassword.passwordRequired'
    });
    minLength(path.password, 8, {
      message: 'auth.resetPassword.passwordMinLength'
    });
    required(path.confirmPassword, {
      message: 'auth.resetPassword.confirmPasswordRequired'
    });
    validate(path.confirmPassword, ({ value, valueOf }) => {
      const confirm = value();
      const password = valueOf(path.password);
      if (confirm && confirm !== password) {
        return {
          kind: 'passwordMismatch',
          message: 'forms.errors.passwordMismatch'
        };
      }
      return null;
    });
  });

  ngOnInit(): void {
    this.#token = this.#route.snapshot.queryParams['token'] || '';

    if (!this.#token) {
      this.invalidToken.set(true);
      this.error.set(
        this.#translocoService.translate('auth.resetPassword.errorNoToken')
      );
    }
  }

  onSubmit(): void {
    if (this.resetPasswordForm().invalid() || !this.#token) return;

    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .resetPassword(this.#token, this.resetPasswordModel().password)
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
              this.#translocoService.translate('auth.resetPassword.errorFailed')
          );
        }
      });
  }
}
