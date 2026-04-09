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

  readonly forgotPasswordModel = signal<ForgotPasswordData>({ email: '' });
  readonly forgotPasswordForm = form(this.forgotPasswordModel, (path) => {
    required(path.email, { message: 'auth.forgotPassword.emailRequired' });
    emailValidator(path.email, { message: 'auth.forgotPassword.emailInvalid' });
  });

  onSubmit(): void {
    if (this.forgotPasswordForm().invalid()) return;

    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .forgotPassword(this.forgotPasswordModel().email)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.success.set(true);
          setTimeout(() => this.successHeading?.nativeElement.focus());
        },
        error: () => {
          this.loading.set(false);
          this.error.set(
            this.#translocoService.translate('auth.forgotPassword.errorFailed')
          );
        }
      });
  }
}
