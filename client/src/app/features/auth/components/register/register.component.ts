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
import {
  email as emailValidator,
  form,
  minLength,
  required
} from '@angular/forms/signals';
import { AppFormFieldComponent } from '@shared/forms/app-form-field/app-form-field.component';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { PasswordStrengthComponent } from '@shared/components/password-strength/password-strength.component';
import { CaptchaWidgetComponent } from '@shared/components/captcha-widget/captcha-widget.component';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { ErrorKeys } from '@app/shared/constants';

type RegisterData = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

@Component({
  selector: 'app-register',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatButton,
    MatProgressSpinner,
    MatCardActions,
    RouterLink,
    AppFormFieldComponent,
    PasswordToggleComponent,
    PasswordStrengthComponent,
    CaptchaWidgetComponent,
    TranslocoDirective
  ],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RegisterComponent {
  readonly #authService = inject(AuthService);
  readonly #router = inject(Router);
  readonly #destroyRef = inject(DestroyRef);
  readonly #translocoService = inject(TranslocoService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly captchaRequired = signal(false);
  protected readonly captchaToken = signal<string | null>(null);

  protected readonly appRouteSegmentEnum = AppRouteSegmentEnum;

  readonly registerModel = signal<RegisterData>({
    email: '',
    firstName: '',
    lastName: '',
    password: ''
  });

  readonly registerForm = form(this.registerModel, (path) => {
    required(path.email, { message: 'auth.register.emailRequired' });
    emailValidator(path.email, { message: 'auth.register.emailInvalid' });
    required(path.firstName, { message: 'auth.register.firstNameRequired' });
    required(path.lastName, { message: 'auth.register.lastNameRequired' });
    required(path.password, { message: 'auth.register.passwordRequired' });
    minLength(path.password, 8, {
      message: 'auth.register.passwordMinLength'
    });
  });

  protected onCaptchaToken(token: string | null): void {
    this.captchaToken.set(token);
  }

  protected canSubmit(): boolean {
    if (this.registerForm().invalid() || this.loading()) return false;
    if (this.captchaRequired() && !this.captchaToken()) return false;
    return true;
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;

    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .register(this.registerModel(), this.captchaToken())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`], {
            queryParams: { registered: 'pending-verification' }
          });
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          const errorKey = err.error?.errorKey as string | undefined;
          if (
            errorKey === ErrorKeys.AUTH.CAPTCHA_REQUIRED ||
            errorKey === ErrorKeys.AUTH.CAPTCHA_INVALID
          ) {
            this.captchaRequired.set(true);
            this.captchaToken.set(null);
            this.error.set(this.#translocoService.translate(errorKey));
            return;
          }
          if (err.status === 409) {
            this.error.set(
              this.#translocoService.translate('auth.register.errorEmailExists')
            );
          } else {
            this.error.set(
              errorKey
                ? this.#translocoService.translate(errorKey)
                : this.#translocoService.translate('auth.register.errorFailed')
            );
          }
        }
      });
  }
}
