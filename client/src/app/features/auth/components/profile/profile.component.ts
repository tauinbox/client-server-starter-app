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
import { MatChip, MatChipAvatar } from '@angular/material/chips';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import {
  email as emailValidator,
  form,
  minLength,
  required,
  validate
} from '@angular/forms/signals';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
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
import {
  isOAuthProvider,
  OAUTH_URLS,
  type OAuthProvider
} from '../../constants/auth-api.const';
import { OAUTH_ERROR_CANCELLED } from '../../constants/oauth-error.const';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { PasswordStrengthComponent } from '@shared/components/password-strength/password-strength.component';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import {
  isAdminRole,
  roleIcon,
  sortRolesForDisplay
} from '@shared/utils/role-display.utils';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import {
  MatButtonToggle,
  MatButtonToggleGroup
} from '@angular/material/button-toggle';
import { LanguageService } from '@core/services/language.service';
import type { AppLanguage } from '@core/services/language.service';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { DisplayPreferencesService } from '@core/services/display-preferences.service';
import {
  DENSITY_MAX,
  DENSITY_MIN
} from '@core/services/display-preferences.service';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { OAUTH_PROVIDER_FLAGS } from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';

type ProfileData = {
  email: string;
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

/** Keyed by OAuthProvider so a new entry in OAUTH_URLS fails the build until it gets a label. */
const PROVIDER_KEYS: Record<OAuthProvider, string> = {
  google: 'auth.providers.google',
  facebook: 'auth.providers.facebook',
  vk: 'auth.providers.vk'
};

const INITIAL_PROFILE: ProfileData = {
  email: '',
  firstName: '',
  lastName: '',
  currentPassword: '',
  password: '',
  confirmPassword: ''
};

/**
 * Both sides of every "did the e-mail change?" comparison go through the shared
 * canonicalizer: comparing a normalised form value against a raw stored address
 * reports a change for an address that only differs in case.
 */
function canonicalEmail(value: string | undefined): string {
  return normalizeEmail(value) ?? '';
}

@Component({
  selector: 'nxs-profile',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatChip,
    MatChipAvatar,
    MatProgressSpinner,
    MatButton,
    MatIcon,
    DatePipe,
    PasswordToggleComponent,
    PasswordStrengthComponent,
    NxsFormFieldComponent,
    TranslocoDirective,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatSlider,
    MatSliderThumb
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
  readonly #transloco = inject(TranslocoService);
  readonly #adaptiveDialog = inject(AdaptiveDialogService);
  readonly #languageService = inject(LanguageService);
  readonly #flagsStore = inject(FeatureFlagsStore);
  readonly #displayPreferences = inject(DisplayPreferencesService);

  protected readonly displayDensity = this.#displayPreferences.density;
  protected readonly densityMin = DENSITY_MIN;
  protected readonly densityMax = DENSITY_MAX;

  protected readonly user = signal<UserResponse | null>(null);
  readonly roleChips = computed(() =>
    sortRolesForDisplay(this.user()?.roles ?? [])
  );
  protected readonly roleIcon = roleIcon;
  protected readonly isAdminRole = isAdminRole;
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

  // A provider is shown when its public flag resolves true (server-gated on the
  // provider being configured) OR the user already has it linked — so a stale
  // link to a now-unconfigured provider can still be removed. The whole
  // "connected accounts" card is hidden when none qualify.
  protected readonly visibleProviders = computed(() => {
    const flags = this.#flagsStore.flags();
    const linked = new Set(this.oauthAccounts().map((a) => a.provider));
    return OAUTH_PROVIDER_FLAGS.filter(
      (p) => flags[p.flagKey] === true || linked.has(p.provider)
    ).map((p) => p.provider);
  });
  protected readonly locale = signal<AppLanguage>('en');
  protected readonly savingLocale = signal(false);

  readonly profileModel = signal<ProfileData>({ ...INITIAL_PROFILE });

  readonly profileForm = form(this.profileModel, (path) => {
    required(path.email, { message: 'auth.profile.emailRequired' });
    emailValidator(path.email, { message: 'auth.profile.emailInvalid' });
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
      const emailValue = canonicalEmail(valueOf(path.email));
      const loaded = canonicalEmail(this.user()?.email);
      const emailChanged = !!loaded && emailValue !== loaded;
      if (!password && !emailChanged) return null;
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

  /**
   * The currentPassword field appears whenever a sensitive change is queued —
   * either a password update OR an email change. Both require fresh proof of
   * password ownership.
   */
  protected readonly requiresCurrentPassword = computed(() => {
    const data = this.profileModel();
    if (data.password) return true;
    const loaded = canonicalEmail(this.user()?.email);
    if (!loaded) return false;
    return canonicalEmail(data.email) !== loaded;
  });

  ngOnInit() {
    this.loadProfile();
    this.loadOAuthAccounts();
    this.#checkOAuthLinkedParam();
  }

  #checkOAuthLinkedParam(): void {
    const provider = this.#route.snapshot.queryParamMap.get('oauth_linked');
    const error = this.#route.snapshot.queryParamMap.get('oauth_error');

    if (provider) {
      // A forged ?oauth_linked= value never linked anything, so it gets no toast.
      if (isOAuthProvider(provider)) {
        this.#notify.success('auth.profile.oauthConnected', {
          provider: this.#providerLabel(provider)
        });
      }
      void this.#router.navigate([], {
        queryParams: { oauth_linked: null },
        queryParamsHandling: 'merge'
      });
    } else if (error) {
      if (error === OAUTH_ERROR_CANCELLED) {
        this.#notify.info('auth.profile.linkCancelled');
      } else {
        this.#notify.error('auth.profile.errorLinkFailed');
      }
      void this.#router.navigate([], {
        queryParams: { oauth_error: null },
        queryParamsHandling: 'merge'
      });
    }
  }

  /** Unknown providers cannot reach a label key, so the raw name is the last resort. */
  #providerLabel(provider: string): string {
    return isOAuthProvider(provider)
      ? this.#transloco.translate(PROVIDER_KEYS[provider])
      : provider;
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
          this.locale.set(user.locale === 'ru' ? 'ru' : 'en');
          this.profileModel.set({
            email: user.email,
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
          this.error.set(
            parseHttpErrorMessage(
              err,
              this.#transloco,
              'auth.profile.errorLoadFailed'
            )
          );
        }
      });
  }

  /**
   * Persists the account's preferred locale (used for server-sent emails) and
   * syncs the live UI language. Persistence is independent of the profile form.
   */
  onLocaleChange(value: AppLanguage): void {
    const previous = this.locale();
    if (value === previous) return;

    this.locale.set(value);
    this.savingLocale.set(true);

    this.#authService
      .updateProfile({ locale: value })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (updated) => {
          this.savingLocale.set(false);
          this.user.set(updated);
          void this.#languageService.setLanguage(value);
          this.#notify.success('auth.profile.languageUpdated');
        },
        error: (err: HttpErrorResponse) => {
          this.savingLocale.set(false);
          this.locale.set(previous);
          this.#notify.error(err, 'auth.profile.errorUpdateFailed');
        }
      });
  }

  onDensityChange(level: number): void {
    this.#displayPreferences.setDensity(level);
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
    if (!isOAuthProvider(provider)) return;

    this.oauthLoading.set(true);
    this.#authService
      .initOAuthLink()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#sessionStorage.setItem('oauth_return_url', '/profile');
          if (this.#window) {
            this.#window.location.href = OAUTH_URLS[provider];
          }
        },
        error: (err: HttpErrorResponse) => {
          this.oauthLoading.set(false);
          this.#notify.error(err, 'auth.profile.errorInitiateLinkFailed');
        }
      });
  }

  disconnectProvider(provider: string): void {
    if (!isOAuthProvider(provider)) return;

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
          this.#notify.success('auth.profile.oauthDisconnected', {
            provider: this.#providerLabel(provider)
          });
        },
        error: (err: HttpErrorResponse) => {
          this.oauthLoading.set(false);
          this.#notify.error(err, 'auth.profile.errorDisconnectFailed');
        }
      });
  }

  onSubmit(): void {
    const u = this.user();
    if (this.profileForm().invalid() || !u) return;

    const formValues = this.profileModel();
    const newEmail = canonicalEmail(formValues.email);
    const emailChanged = !!u.email && newEmail !== canonicalEmail(u.email);

    if (emailChanged) {
      this.#adaptiveDialog
        .openConfirm({
          title: this.#transloco.translate(
            'auth.profile.confirmEmailChangeTitle'
          ),
          message: this.#transloco.translate(
            'auth.profile.confirmEmailChangeMessage',
            { newEmail }
          ),
          confirmButton: this.#transloco.translate(
            'auth.profile.confirmEmailChangeButton'
          ),
          cancelButton: this.#transloco.translate('common.cancel'),
          icon: 'mark_email_unread'
        })
        .pipe(takeUntilDestroyed(this.#destroyRef))
        .subscribe((confirmed) => {
          if (confirmed) {
            this.#initiateEmailChange(newEmail, formValues.currentPassword);
          }
        });
      return;
    }

    this.#savePersonalUpdates();
  }

  #initiateEmailChange(newEmail: string, currentPassword: string): void {
    this.saving.set(true);
    this.error.set(null);

    this.#authService
      .initiateEmailChange(newEmail, currentPassword)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.#notify.success('auth.profile.emailChangeInitiated');
          // Revert the form's email back to the loaded address — the change
          // is not applied until the user confirms via the email link.
          const current = this.user();
          if (current) {
            this.profileModel.update((data) => ({
              ...data,
              email: current.email,
              currentPassword: ''
            }));
            this.profileForm().reset();
          }
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(
            parseHttpErrorMessage(
              err,
              this.#transloco,
              'auth.profile.errorEmailChangeFailed'
            )
          );
        }
      });
  }

  #savePersonalUpdates(): void {
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
            email: updatedUser.email,
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
          this.error.set(
            parseHttpErrorMessage(
              err,
              this.#transloco,
              'auth.profile.errorUpdateFailed'
            )
          );
        }
      });
  }
}
