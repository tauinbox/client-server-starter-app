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
import { form, minLength, required, validate } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { DOCUMENT, DatePipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { SessionStorageService } from '@core/services/session-storage.service';
import { NotifyService } from '@core/services/notify.service';
import type { UserResponse } from '@app/shared/types';
import type { UpdateProfile } from '../../models/auth.types';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OAUTH_URLS } from '../../constants/auth-api.const';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { AppFormFieldComponent } from '@shared/forms/app-form-field/app-form-field.component';
import { AuthStore } from '@features/auth/store/auth.store';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

type ProfileData = {
  firstName: string;
  lastName: string;
  currentPassword: string;
  password: string;
  confirmPassword: string;
};

type OAuthAccountInfo = {
  provider: string;
  createdAt: string;
};

const PROVIDER_KEYS: Record<string, string> = {
  google: 'auth.providers.google',
  facebook: 'auth.providers.facebook',
  vk: 'auth.providers.vk'
};

const INITIAL_PROFILE: ProfileData = {
  firstName: '',
  lastName: '',
  currentPassword: '',
  password: '',
  confirmPassword: ''
};

@Component({
  selector: 'app-profile',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatChip,
    MatProgressSpinner,
    MatButton,
    MatIcon,
    DatePipe,
    PasswordToggleComponent,
    AppFormFieldComponent,
    TranslocoDirective
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProfileComponent implements OnInit {
  readonly #authService = inject(AuthService);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #sessionStorage = inject(SessionStorageService);
  readonly #window = inject(DOCUMENT).defaultView;
  readonly #route = inject(ActivatedRoute);
  readonly #router = inject(Router);
  readonly #authStore = inject(AuthStore);
  readonly #transloco = inject(TranslocoService);

  /**
   * Drives the role chip label. Based on the super-ability rather than a
   * role-name string so the label tracks the user's effective permissions
   * even if the system role is renamed.
   */
  readonly hasSuper = computed(() =>
    this.#authStore.hasPermissions({ action: 'manage', subject: 'all' })
  );
  protected readonly user = signal<UserResponse | null>(null);
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

  readonly profileModel = signal<ProfileData>({ ...INITIAL_PROFILE });

  readonly profileForm = form(this.profileModel, (path) => {
    required(path.firstName, {
      message: 'auth.profile.firstNameRequired'
    });
    required(path.lastName, {
      message: 'auth.profile.lastNameRequired'
    });
    minLength(path.password, 8, {
      message: 'auth.profile.passwordMinLength'
    });
    validate(path.currentPassword, ({ value, valueOf }) => {
      const password = valueOf(path.password);
      if (!password) return null;
      if (!value().trim()) {
        return {
          kind: 'currentPasswordRequired',
          message: 'auth.profile.currentPasswordRequired'
        };
      }
      return null;
    });
    validate(path.confirmPassword, ({ value, valueOf }) => {
      const confirm = value();
      const password = valueOf(path.password);
      if (!password) return null;
      if (confirm !== password) {
        return {
          kind: 'passwordMismatch',
          message: 'forms.errors.passwordMismatch'
        };
      }
      return null;
    });
  });

  protected readonly hasPassword = computed(
    () => !!this.profileModel().password
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
      this.#notify.success('auth.profile.oauthConnected', {
        provider: providerLabel
      });
      void this.#router.navigate([], {
        queryParams: { oauth_linked: null },
        queryParamsHandling: 'merge'
      });
    } else if (error) {
      this.#notify.error('auth.profile.errorLinkFailed');
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
          this.profileModel.set({
            firstName: user.firstName,
            lastName: user.lastName,
            currentPassword: '',
            password: '',
            confirmPassword: ''
          });
          this.loading.set(false);
          this.profileForm().reset();
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
          this.#notify.error(err, 'auth.profile.errorInitiateLinkFailed');
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
          this.#notify.success('auth.profile.oauthDisconnected', {
            provider: providerLabel
          });
        },
        error: (err: HttpErrorResponse) => {
          this.oauthLoading.set(false);
          this.#notify.error(err, 'auth.profile.errorDisconnectFailed');
        }
      });
  }

  onSubmit(): void {
    if (this.profileForm().invalid() || !this.user()) return;

    const formValues = this.profileModel();

    const updateData: UpdateProfile = {
      firstName: formValues.firstName,
      lastName: formValues.lastName
    };

    if (formValues.password.trim()) {
      updateData.password = formValues.password;
      updateData.currentPassword = formValues.currentPassword;
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

          this.profileModel.set({
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            currentPassword: '',
            password: '',
            confirmPassword: ''
          });
          this.profileForm().reset();

          this.#notify.success('auth.profile.successUpdated');
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
