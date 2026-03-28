import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatChip } from '@angular/material/chips';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import type {
  AbstractControl,
  FormControl,
  FormGroup,
  ValidationErrors
} from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MatError,
  MatFormField,
  MatLabel,
  MatSuffix
} from '@angular/material/form-field';
import type { ErrorStateMatcher } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { DOCUMENT } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { SessionStorageService } from '@core/services/session-storage.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { User } from '@shared/models/user.types';
import type { UpdateProfile } from '../../models/auth.types';
import { DatePipe } from '@angular/common';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OAUTH_URLS } from '../../constants/auth-api.const';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { AuthStore } from '@features/auth/store/auth.store';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

type ProfileFormType = {
  firstName: FormControl<string>;
  lastName: FormControl<string>;
  password: FormControl<string>;
  confirmPassword: FormControl<string>;
};

function passwordsMatchValidator(
  group: AbstractControl
): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  if (!password) return null;
  return password === confirm ? null : { passwordsMismatch: true };
}

type OAuthAccountInfo = {
  provider: string;
  createdAt: string;
};

const PROVIDER_KEYS: Record<string, string> = {
  google: 'auth.providers.google',
  facebook: 'auth.providers.facebook',
  vk: 'auth.providers.vk'
};

@Component({
  selector: 'app-profile',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatChip,
    MatError,
    MatLabel,
    MatProgressSpinner,
    ReactiveFormsModule,
    MatFormField,
    MatIcon,
    MatInput,
    MatButton,
    DatePipe,
    PasswordToggleComponent,
    MatSuffix,
    TranslocoDirective
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProfileComponent implements OnInit {
  readonly #fb = inject(FormBuilder);
  readonly #authService = inject(AuthService);
  readonly #snackBar = inject(MatSnackBar);
  readonly #destroyRef = inject(DestroyRef);
  readonly #sessionStorage = inject(SessionStorageService);
  readonly #window = inject(DOCUMENT).defaultView;
  readonly #route = inject(ActivatedRoute);
  readonly #router = inject(Router);
  readonly #authStore = inject(AuthStore);
  readonly #transloco = inject(TranslocoService);

  protected readonly confirmPasswordErrorMatcher: ErrorStateMatcher = {
    isErrorState: () =>
      !!this.profileForm.errors?.['passwordsMismatch'] &&
      !!this.profileForm.get('confirmPassword')?.touched
  };

  readonly isAdmin = this.#authStore.isAdmin;
  protected readonly user = signal<User | null>(null);
  readonly initials = computed(() => {
    const u = this.user();
    if (!u) return '';
    return `${u.firstName.charAt(0)}${u.lastName.charAt(0)}`.toUpperCase();
  });
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly oauthAccounts = signal<OAuthAccountInfo[]>([]);
  protected readonly oauthLoading = signal(false);
  protected readonly allProviders = Object.keys(OAUTH_URLS);

  protected readonly profileForm: FormGroup<ProfileFormType> =
    this.#fb.group<ProfileFormType>(
      {
        firstName: this.#fb.control('', {
          validators: [Validators.required],
          nonNullable: true
        }),
        lastName: this.#fb.control('', {
          validators: [Validators.required],
          nonNullable: true
        }),
        password: this.#fb.control('', {
          validators: [Validators.minLength(8)],
          nonNullable: true
        }),
        confirmPassword: this.#fb.control('', {
          nonNullable: true
        })
      },
      { validators: [passwordsMatchValidator] }
    );

  ngOnInit() {
    this.loadProfile();
    this.loadOAuthAccounts();
    this.#checkOAuthLinkedParam();
  }

  #checkOAuthLinkedParam(): void {
    const provider = this.#route.snapshot.queryParamMap.get('oauth_linked');
    const error = this.#route.snapshot.queryParamMap.get('oauth_error');

    if (provider) {
      const providerLabel = this.#transloco.translate(
        PROVIDER_KEYS[provider] || 'auth.providers.' + provider
      );
      this.#snackBar.open(
        this.#transloco.translate('auth.profile.oauthConnected', {
          provider: providerLabel
        }),
        'Close',
        { duration: 5000 }
      );
      void this.#router.navigate([], {
        queryParams: { oauth_linked: null },
        queryParamsHandling: 'merge'
      });
    } else if (error) {
      this.#snackBar.open(
        this.#transloco.translate('auth.profile.errorLinkFailed'),
        'Close',
        { duration: 5000 }
      );
      void this.#router.navigate([], {
        queryParams: { oauth_error: null },
        queryParamsHandling: 'merge'
      });
    }
  }

  loadProfile(): void {
    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .getProfile()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (user) => {
          this.user.set(user);
          this.profileForm.patchValue({
            firstName: user.firstName,
            lastName: user.lastName,
            password: '',
            confirmPassword: ''
          });
          this.loading.set(false);
          this.profileForm.markAsPristine();
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          const errorMessage =
            err.error?.message ||
            this.#transloco.translate('auth.profile.errorLoadFailed');
          this.error.set(errorMessage);
        }
      });
  }

  loadOAuthAccounts(): void {
    this.#authService
      .getOAuthAccounts()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (accounts) => this.oauthAccounts.set(accounts),
        error: () => this.oauthAccounts.set([])
      });
  }

  isProviderLinked(provider: string): boolean {
    return this.oauthAccounts().some((a) => a.provider === provider);
  }

  connectProvider(provider: string): void {
    this.oauthLoading.set(true);
    this.#authService
      .initOAuthLink()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#sessionStorage.setItem('oauth_return_url', '/profile');
          if (this.#window) {
            this.#window.location.href =
              OAUTH_URLS[provider as keyof typeof OAUTH_URLS];
          }
        },
        error: (err: HttpErrorResponse) => {
          this.oauthLoading.set(false);
          this.#snackBar.open(
            err.error?.message ||
              this.#transloco.translate('auth.profile.errorInitiateLinkFailed'),
            'Close',
            { duration: 5000 }
          );
        }
      });
  }

  disconnectProvider(provider: string): void {
    this.oauthLoading.set(true);
    this.#authService
      .unlinkOAuthAccount(provider)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.oauthLoading.set(false);
          this.oauthAccounts.update((accounts) =>
            accounts.filter((a) => a.provider !== provider)
          );
          const providerLabel = this.#transloco.translate(
            PROVIDER_KEYS[provider] || 'auth.providers.' + provider
          );
          this.#snackBar.open(
            this.#transloco.translate('auth.profile.oauthDisconnected', {
              provider: providerLabel
            }),
            'Close',
            { duration: 5000 }
          );
        },
        error: (err: HttpErrorResponse) => {
          this.oauthLoading.set(false);
          this.#snackBar.open(
            err.error?.message ||
              this.#transloco.translate('auth.profile.errorDisconnectFailed'),
            'Close',
            { duration: 5000 }
          );
        }
      });
  }

  onSubmit(): void {
    if (this.profileForm.invalid || !this.user()) return;

    const formValues = this.profileForm.getRawValue();

    const updateData: UpdateProfile = {
      firstName: formValues.firstName,
      lastName: formValues.lastName
    };

    if (formValues.password.trim()) {
      updateData.password = formValues.password;
    }

    this.saving.set(true);
    this.error.set(null);

    this.#authService
      .updateProfile(updateData)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (updatedUser) => {
          this.saving.set(false);
          this.user.set(updatedUser);

          this.profileForm.patchValue({ password: '', confirmPassword: '' });
          this.profileForm.markAsPristine();

          this.#snackBar.open(
            this.#transloco.translate('auth.profile.successUpdated'),
            'Close',
            { duration: 5000 }
          );
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          const errorMessage =
            err.error?.message ||
            this.#transloco.translate('auth.profile.errorUpdateFailed');
          this.error.set(errorMessage);
        }
      });
  }
}
