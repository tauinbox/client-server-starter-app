import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  ViewChild,
  type ElementRef
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
  required
} from '@angular/forms/signals';
import { AppFormFieldComponent } from '@shared/forms/app-form-field/app-form-field.component';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { CaptchaWidgetComponent } from '@shared/components/captcha-widget/captcha-widget.component';
import { ErrorKeys } from '@app/shared/constants';
import type { HttpErrorResponse } from '@angular/common/http';

type ForgotPasswordData = {
  email: string;
};

@Component({
  selector: 'app-forgot-password',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatCardActions,
    MatIcon,
    MatButton,
    MatProgressSpinner,
    RouterLink,
    AppFormFieldComponent,
    CaptchaWidgetComponent,
    TranslocoDirective
  ],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ForgotPasswordComponent {
  readonly #authService = inject(AuthService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #translocoService = inject(TranslocoService);

  @ViewChild('successHeading') successHeading?: ElementRef<HTMLElement>;

  protected readonly loading = signal(false);
  protected readonly success = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly captchaRequired = signal(false);
  protected readonly captchaToken = signal<string | null>(null);

  readonly forgotPasswordModel = signal<ForgotPasswordData>({ email: '' });
  readonly forgotPasswordForm = form(this.forgotPasswordModel, (path) => {
    required(path.email, { message: 'auth.forgotPassword.emailRequired' });
    emailValidator(path.email, { message: 'auth.forgotPassword.emailInvalid' });
  });

  protected onCaptchaToken(token: string | null): void {
    this.captchaToken.set(token);
  }

  protected canSubmit(): boolean {
    if (this.forgotPasswordForm().invalid() || this.loading()) return false;
    if (this.captchaRequired() && !this.captchaToken()) return false;
    return true;
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;

    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .forgotPassword(this.forgotPasswordModel().email, this.captchaToken())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.success.set(true);
          setTimeout(() => this.successHeading?.nativeElement.focus());
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
          this.error.set(
            this.#translocoService.translate('auth.forgotPassword.errorFailed')
          );
        }
      });
  }
}
