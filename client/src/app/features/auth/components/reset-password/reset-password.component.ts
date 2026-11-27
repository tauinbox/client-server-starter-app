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
import {
  form,
  maxLength,
  minLength,
  required,
  validate
} from '@angular/forms/signals';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import {
  PASSWORD_CHANGED,
  PASSWORD_CHANGED_PARAM
} from '../../constants/password-changed.const';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { PasswordStrengthComponent } from '@shared/components/password-strength/password-strength.component';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type DataRegion
} from '@app/shared/constants';
import { linkRegion } from '../../utils/link-region';

type ResetPasswordData = {
  password: string;
  confirmPassword: string;
};

@Component({
  selector: 'nxs-reset-password',
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
    PasswordStrengthComponent,
    NxsFormFieldComponent,
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
  /** The translation key of the reason the link cannot be used. */
  protected readonly invalidLink = signal<string | null>(null);

  #token = '';
  #region: DataRegion | null = null;

  readonly resetPasswordModel = signal<ResetPasswordData>({
    password: '',
    confirmPassword: ''
  });

  readonly resetPasswordForm = form(this.resetPasswordModel, (path) => {
    required(path.password, {
      message: 'auth.resetPassword.passwordRequired'
    });
    minLength(path.password, MIN_PASSWORD_LENGTH, {
      message: 'auth.resetPassword.passwordMinLength'
    });
    maxLength(path.password, MAX_PASSWORD_LENGTH, {
      message: 'auth.resetPassword.passwordMaxLength'
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
    const { queryParams } = this.#route.snapshot;

    this.#token = queryParams['token'] || '';
    this.#region = linkRegion(queryParams['region']);

    if (!this.#token) {
      this.invalidLink.set('auth.resetPassword.errorNoToken');
    } else if (this.#region === null) {
      this.invalidLink.set('auth.resetPassword.errorUnknownRegion');
    }
  }

  onSubmit(): void {
    const region = this.#region;

    if (this.resetPasswordForm().invalid() || !this.#token || region === null)
      return;

    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .resetPassword(this.#token, {
        password: this.resetPasswordModel().password,
        region
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`], {
            queryParams: { [PASSWORD_CHANGED_PARAM]: PASSWORD_CHANGED.Done },
            replaceUrl: true
          });
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.error.set(
            parseHttpErrorMessage(
              err,
              this.#translocoService,
              'auth.resetPassword.errorFailed'
            )
          );
        }
      });
  }
}
