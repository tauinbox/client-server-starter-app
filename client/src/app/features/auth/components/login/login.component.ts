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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { AuthService } from '../../services/auth.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OAUTH_URLS } from '../../constants/auth-api.const';

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
export class LoginComponent implements OnInit {
  readonly #fb = inject(FormBuilder);
  readonly #authService = inject(AuthService);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);
  readonly #destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly oauthUrls = OAUTH_URLS;

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
    const iconRegistry = inject(MatIconRegistry);
    const sanitizer = inject(DomSanitizer);

    iconRegistry.addSvgIcon(
      'google',
      sanitizer.bypassSecurityTrustResourceUrl('/assets/icons/google.svg')
    );
    iconRegistry.addSvgIcon(
      'facebook',
      sanitizer.bypassSecurityTrustResourceUrl('/assets/icons/facebook.svg')
    );
    iconRegistry.addSvgIcon(
      'vk',
      sanitizer.bypassSecurityTrustResourceUrl('/assets/icons/vk.svg')
    );
  }

  ngOnInit(): void {
    const oauthError = this.#route.snapshot.queryParams['oauth_error'];
    if (oauthError) {
      this.error.set(
        OAUTH_ERROR_MESSAGES[oauthError] ||
          'Authentication failed. Please try again.'
      );
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((prev) => !prev);
  }

  onOAuthLogin(provider: string): void {
    sessionStorage.setItem(
      'oauth_return_url',
      this.#route.snapshot.queryParams['returnUrl'] || '/'
    );
    window.location.href = this.oauthUrls[provider as keyof typeof OAUTH_URLS];
  }

  onSubmit(): void {
    if (this.loginForm.invalid) return;

    this.loading.set(true);
    this.error.set(null);

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
          this.error.set(
            err.error?.message || 'Login failed. Please check your credentials.'
          );
        }
      });
  }
}
