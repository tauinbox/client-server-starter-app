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
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatIcon, MatIconRegistry } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDivider } from '@angular/material/divider';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { AuthService } from '../../services/auth.service';
import { SessionStorageService } from '@core/services/session-storage.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OAUTH_URLS } from '../../constants/auth-api.const';
import { registerOAuthIcons } from '../../utils/register-oauth-icons';
import type { LockoutErrorData } from '../../models/auth.types';

type LoginFormType = {
  email: FormControl<string>;
  password: FormControl<string>;
};

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'OAuth authentication failed. Please try again.',
  no_email:
    'No email was provided by the OAuth provider. Please use a different sign-in method.'
};

@Component({
  selector: 'app-login',
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
    MatCardActions,
    MatDivider,
    RouterLink
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

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
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
      nonNullable: true
    }),
    password: this.#fb.control('', {
      validators: [Validators.required],
      nonNullable: true
    })
  });

  constructor() {
    registerOAuthIcons(inject(MatIconRegistry), inject(DomSanitizer));
  }

  ngOnInit(): void {
    const oauthError = this.#route.snapshot.queryParams['oauth_error'];
    if (oauthError) {
      this.error.set(
        OAUTH_ERROR_MESSAGES[oauthError] ||
          'Authentication failed. Please try again.'
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

  togglePasswordVisibility(): void {
    this.showPassword.update((prev) => !prev);
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
    if (err.status === 423) {
      const data = err.error as LockoutErrorData;
      this.#startLockoutCountdown(data.retryAfter);
      this.error.set(data.message);
      return;
    }

    if (err.status === 403 && err.error?.errorCode === 'EMAIL_NOT_VERIFIED') {
      this.emailNotVerified.set(true);
      this.error.set(err.error.message);
      return;
    }

    this.error.set(
      err.error?.message || 'Login failed. Please check your credentials.'
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
