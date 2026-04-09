import type { OnDestroy, OnInit } from '@angular/core';
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
import { AppFormFieldComponent } from '@shared/forms/app-form-field/app-form-field.component';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDivider } from '@angular/material/divider';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { SessionStorageService } from '@core/services/session-storage.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OAUTH_URLS } from '../../constants/auth-api.const';
import type { LockoutErrorData } from '../../models/auth.types';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

type LoginFormType = {
  email: FormControl<string>;
  password: FormControl<string>;
};

const OAUTH_ERROR_KEYS: Record<string, string> = {
  auth_failed: 'auth.login.errorOauthFailed',
  no_email: 'auth.login.errorNoEmail'
};

@Component({
  selector: 'app-login',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    ReactiveFormsModule,
    MatIcon,
    MatButton,
    MatProgressSpinner,
    MatCardActions,
    MatDivider,
    RouterLink,
    AppFormFieldComponent,
    PasswordToggleComponent,
    TranslocoDirective
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent implements OnInit, OnDestroy {
  readonly #fb = inject(FormBuilder);
  readonly #authService = inject(AuthService);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);
  readonly #destroyRef = inject(DestroyRef);
  readonly #sessionStorage = inject(SessionStorageService);
  readonly #window = inject(DOCUMENT).defaultView;
  readonly #translocoService = inject(TranslocoService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly oauthUrls = OAUTH_URLS;

  // Lockout
  protected readonly lockoutSeconds = signal(0);
  #lockoutTimer: ReturnType<typeof setInterval> | null = null;

  // Email verification
  protected readonly emailNotVerified = signal(false);
  protected readonly resendingVerification = signal(false);
  protected readonly verificationResent = signal(false);

  // Post-registration banner
  protected readonly pendingVerification = signal(false);

  readonly loginForm = this.#fb.group<LoginFormType>({
    email: this.#fb.control('', {
      validators: [Validators.required, Validators.email],
      nonNullable: true,
      updateOn: 'blur'
    }),
    password: this.#fb.control('', {
      validators: [Validators.required],
      nonNullable: true
    })
  });

  ngOnInit(): void {
    const oauthError = this.#route.snapshot.queryParams['oauth_error'];
    if (oauthError) {
      const key = OAUTH_ERROR_KEYS[oauthError];
      this.error.set(
        key
          ? this.#translocoService.translate(key)
          : this.#translocoService.translate('auth.login.errorAuthFailed')
      );
    }

    const registered = this.#route.snapshot.queryParams['registered'];
    if (registered === 'pending-verification') {
      this.pendingVerification.set(true);
    }
  }

  ngOnDestroy(): void {
    this.#clearLockoutTimer();
  }

  onOAuthLogin(provider: string): void {
    this.#sessionStorage.setItem(
      'oauth_return_url',
      this.#route.snapshot.queryParams['returnUrl'] || '/'
    );
    if (this.#window) {
      this.#window.location.href =
        this.oauthUrls[provider as keyof typeof OAUTH_URLS];
    }
  }

  onSubmit(): void {
    if (this.loginForm.invalid) return;

    this.loading.set(true);
    this.error.set(null);
    this.emailNotVerified.set(false);
    this.verificationResent.set(false);
    this.pendingVerification.set(false);

    this.#authService
      .login(this.loginForm.getRawValue())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          const returnUrl =
            this.#route.snapshot.queryParams['returnUrl'] || '/';
          void this.#router.navigateByUrl(returnUrl);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.#handleLoginError(err);
        }
      });
  }

  resendVerification(): void {
    const email = this.loginForm.get('email')?.value;
    if (!email) return;

    this.resendingVerification.set(true);
    this.#authService
      .resendVerificationEmail(email)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.resendingVerification.set(false);
          this.verificationResent.set(true);
        },
        error: () => {
          this.resendingVerification.set(false);
        }
      });
  }

  #handleLoginError(err: HttpErrorResponse): void {
    const errorKey = err.error?.errorKey as string | undefined;

    if (err.status === 423) {
      const data = err.error as LockoutErrorData;
      this.#startLockoutCountdown(data.retryAfter);
      this.error.set(
        errorKey ? this.#translocoService.translate(errorKey) : data.message
      );
      return;
    }

    if (err.status === 403 && err.error?.errorCode === 'EMAIL_NOT_VERIFIED') {
      this.emailNotVerified.set(true);
      this.error.set(
        errorKey
          ? this.#translocoService.translate(errorKey)
          : err.error.message
      );
      return;
    }

    this.error.set(
      errorKey
        ? this.#translocoService.translate(errorKey)
        : this.#translocoService.translate('auth.login.errorCredentialsInvalid')
    );
  }

  #startLockoutCountdown(seconds: number): void {
    this.#clearLockoutTimer();
    this.lockoutSeconds.set(seconds);

    this.#lockoutTimer = setInterval(() => {
      const remaining = this.lockoutSeconds() - 1;
      if (remaining <= 0) {
        this.#clearLockoutTimer();
        this.lockoutSeconds.set(0);
        this.error.set(null);
      } else {
        this.lockoutSeconds.set(remaining);
      }
    }, 1000);
  }

  #clearLockoutTimer(): void {
    if (this.#lockoutTimer) {
      clearInterval(this.#lockoutTimer);
      this.#lockoutTimer = null;
    }
  }
}
