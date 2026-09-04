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
  maxLength,
  minLength,
  required,
  validate
} from '@angular/forms/signals';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { DOCUMENT, DatePipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { AuthStore } from '../../store/auth.store';
import { SessionStorageService } from '@core/services/session-storage.service';
import { NotifyService } from '@core/services/notify.service';
import { TwoFactorComponent } from '../two-factor/two-factor.component';
import type { UserResponse } from '@app/shared/types';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import type { UpdateProfile } from '../../models/auth.types';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { concat, defer, take, tap } from 'rxjs';
import {
  isOAuthProvider,
  OAUTH_URLS,
  type OAuthProvider
} from '../../constants/auth-api.const';
import {
  OAUTH_ERROR_CANCELLED,
  OAUTH_ERROR_REAUTH_FAILED
} from '../../constants/oauth-error.const';
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
import {
  MAX_NEW_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  OAUTH_PROVIDER_FLAGS
} from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';
import { passwordByteLimit } from '@shared/forms/password-byte-limit';

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

/**
 * A step-up re-authentication leaves the app for the provider and comes back
 * as a full page load, so the address the user asked for has to survive it.
 */
const PENDING_EMAIL_KEY = 'pending_email_change';

/**
 * The other resume path. It holds a marker and never the password itself: a
 * credential must not sit in web storage, so the user types it again on return.
 */
const PENDING_PASSWORD_KEY = 'pending_password_set';

/**
 * The third resume path. The two-factor card asks for the round trip and picks
 * the enrolment up again on the load that follows it.
 */
const PENDING_MFA_KEY = 'pending_mfa_setup';

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
    MatSliderThumb,
    TwoFactorComponent
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
  readonly #authStore = inject(AuthStore);

  protected readonly mustEnrolMfa = this.#authStore.mustEnrolMfa;

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
    minLength(path.password, MIN_PASSWORD_LENGTH, {
      message: 'auth.profile.passwordMinLength'
    });
    maxLength(path.password, MAX_NEW_PASSWORD_LENGTH, {
      message: 'auth.profile.passwordMaxLength'
    });
    passwordByteLimit(path.password, 'auth.profile.passwordMaxBytes');
    validate(path.currentPassword, ({ value, valueOf }) => {
      // An account created through a provider holds no password, so demanding
      // one here is the defect this field used to carry.
      if (!this.accountHasPassword()) return null;
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

  protected readonly passwordTyped = computed(
    () => !!this.profileModel().password
  );

  /**
   * False only for an account created through a provider. The profile may not
   * be loaded yet, and the safe default there is the password-bearing shape,
   * because that one asks for a factor rather than skipping it.
   */
  protected readonly accountHasPassword = computed(
    () => this.user()?.hasPassword !== false
  );

  /** The provider a step-up round trip can run against. */
  protected readonly reauthProvider = computed(() => {
    const linked = this.oauthAccounts().map((a) => a.provider);
    return linked.find(isOAuthProvider) ?? null;
  });

  protected readonly reauthProviderLabel = computed(() => {
    const provider = this.reauthProvider();
    return provider ? this.#providerLabel(provider) : '';
  });

  /**
   * The currentPassword field appears whenever a sensitive change is queued -
   * either a password update OR an email change. An account that holds no
   * password proves itself through its provider instead, so the field never
   * applies to it.
   */
  protected readonly requiresCurrentPassword = computed(() => {
    if (!this.accountHasPassword()) return false;
    const data = this.profileModel();
    if (data.password) return true;
    const loaded = canonicalEmail(this.user()?.email);
    if (!loaded) return false;
    return canonicalEmail(data.email) !== loaded;
  });

  /** True when this submit will leave the app for the provider. */
  protected readonly emailChangeNeedsReauth = computed(() => {
    if (this.accountHasPassword()) return false;
    const loaded = canonicalEmail(this.user()?.email);
    if (!loaded) return false;
    return canonicalEmail(this.profileModel().email) !== loaded;
  });

  /**
   * True from the load that follows a completed round trip until the change it
   * was taken for is accepted. The proof itself is an httpOnly cookie the page
   * cannot read, so this is the only signal the form has that a submit is worth
   * sending rather than another trip to the provider.
   */
  readonly #reauthConfirmed = signal(false);

  /** The same signal for the two-factor card, which resumes on its own. */
  protected readonly resumeMfaSetup = signal(false);

  protected readonly passwordSetNeedsReauth = computed(
    () =>
      !this.accountHasPassword() &&
      this.passwordTyped() &&
      !this.#reauthConfirmed()
  );

  /** Null when no notice applies, so the template reads one value. */
  protected readonly reauthNoticeKey = computed(() => {
    if (this.emailChangeNeedsReauth()) return 'auth.profile.reauthNotice';
    if (this.passwordSetNeedsReauth())
      return 'auth.profile.reauthNoticePassword';
    return null;
  });

  ngOnInit() {
    this.loadProfile();
    this.loadOAuthAccounts();

    // Both of these report their outcome through a snackbar, and both run on
    // the load that follows a provider round trip. The `auth` translations are
    // a lazily fetched scope, so at this point `translate()` can still answer
    // with the key itself and put a raw dot-path on screen. Wait for the scope
    // first; an already-loaded one emits from the cache with no extra delay.
    this.#transloco
      .load(`auth/${this.#transloco.getActiveLang()}`)
      .pipe(take(1), takeUntilDestroyed(this.#destroyRef))
      .subscribe(() => {
        this.#checkOAuthLinkedParam();
        this.#resumeAfterReauth();
      });
  }

  /**
   * Runs on the page load that follows a provider round trip. The proof lives
   * in an httpOnly cookie the server set, so all this needs is which change the
   * user asked for before leaving. The two pending keys are read separately,
   * because an email change resumes on its own and a first password waits for
   * the user to type it again.
   */
  #resumeAfterReauth(): void {
    const reauth = this.#route.snapshot.queryParamMap.get('reauth');
    const pendingEmail =
      this.#sessionStorage.getItem<string>(PENDING_EMAIL_KEY);
    const pendingPassword =
      this.#sessionStorage.getItem<boolean>(PENDING_PASSWORD_KEY);
    const pendingMfa = this.#sessionStorage.getItem<boolean>(PENDING_MFA_KEY);
    this.#sessionStorage.removeItem(PENDING_EMAIL_KEY);
    this.#sessionStorage.removeItem(PENDING_PASSWORD_KEY);
    this.#sessionStorage.removeItem(PENDING_MFA_KEY);

    if (reauth !== 'ok') return;

    void this.#router.navigate([], {
      queryParams: { reauth: null },
      queryParamsHandling: 'merge'
    });

    // Confirmed for the password only. The proof is bound to the operation the
    // round trip declared, so a trip taken for the address opens no password
    // submit, and a bare `?reauth=ok` load opens nothing at all.
    this.#reauthConfirmed.set(Boolean(pendingPassword) && !pendingEmail);

    if (pendingEmail) {
      this.#resumeEmailChange(pendingEmail);
      return;
    }

    if (pendingPassword) {
      this.#notify.info('auth.profile.reauthDonePassword');
      return;
    }

    // The card holds the enrolment, so all it needs is the signal that the
    // proof its request will carry is now there.
    if (pendingMfa) {
      this.resumeMfaSetup.set(true);
    }
  }

  /**
   * The two-factor card cannot leave the app on its own: the provider, the
   * label and the return address all belong to this page, exactly as they do
   * for an email change and for a first password.
   */
  protected startMfaReauth(): void {
    const provider = this.reauthProvider();
    if (!provider) {
      this.#notify.error('auth.profile.errorReauthNoProvider');
      return;
    }

    this.#authService
      .initOAuthReauth(STEP_UP_OPERATION.MFA_SETUP)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#sessionStorage.setItem(PENDING_MFA_KEY, true);
          this.#notify.info('auth.profile.reauthRedirecting', {
            provider: this.reauthProviderLabel()
          });
          if (this.#window) {
            this.#window.location.href = OAUTH_URLS[provider];
          }
        },
        error: (err: HttpErrorResponse) => {
          this.#notify.error(err, 'auth.profile.errorReauthFailed');
        }
      });
  }

  #resumeEmailChange(pending: string): void {
    this.saving.set(true);
    this.#authService
      .initiateEmailChange(pending)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.#notify.success('auth.profile.emailChangeInitiated');
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
      } else if (error === OAUTH_ERROR_REAUTH_FAILED) {
        this.#notify.error('auth.profile.errorReauthFailed');
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
    // A reload takes the two-factor card down and builds a new one, which
    // would read a stale resume signal and ask for a second secret.
    this.resumeMfaSetup.set(false);

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

    const newEmail = canonicalEmail(this.profileModel().email);
    const emailChanged = !!u.email && newEmail !== canonicalEmail(u.email);

    if (!emailChanged) {
      this.#save(null);
      return;
    }

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
        if (confirmed) this.#save(newEmail);
      });
  }

  /**
   * One submit carries every edit on the form, so an email change never
   * discards the name or password typed alongside it. The two requests run in
   * sequence and in this order because they share the current password: the
   * profile update rehashes it and revokes the session, so an initiate sent
   * afterwards would be rejected as a wrong password.
   */
  #save(newEmail: string | null): void {
    const values = this.profileModel();
    const updateData = this.#buildProfileUpdate(values, newEmail !== null);

    if (newEmail !== null && !this.accountHasPassword()) {
      this.#startReauthForEmailChange(newEmail, updateData);
      return;
    }

    if (this.passwordSetNeedsReauth()) {
      this.#startReauthForPasswordSet();
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const ops: Observable<unknown>[] = [];
    let emailInitiated = false;
    let savedUser: UserResponse | null = null;

    if (newEmail !== null) {
      ops.push(
        this.#authService
          .initiateEmailChange(newEmail, values.currentPassword)
          .pipe(
            tap({
              complete: () => {
                emailInitiated = true;
              }
            })
          )
      );
    }

    if (updateData) {
      // Deferred so a failed email initiation leaves the profile untouched:
      // the request is never even built, let alone sent.
      ops.push(
        defer(() => this.#authService.updateProfile(updateData)).pipe(
          tap((user) => {
            savedUser = user;
          })
        )
      );
    }

    concat(...ops)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        complete: () => {
          this.saving.set(false);
          this.#applySavedProfile(savedUser);
          this.#notify.success(
            this.#successKey(newEmail !== null, !!savedUser)
          );
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          // A proof that expired between the round trip and this submit leaves
          // the form with nothing to retry against, so the next submit has to
          // start a fresh round trip rather than repeat this failure.
          if (
            (err.error as { errorKey?: string } | null)?.errorKey ===
            ErrorKeys.AUTH.REAUTH_REQUIRED
          ) {
            this.#reauthConfirmed.set(false);
          }
          this.error.set(
            parseHttpErrorMessage(
              err,
              this.#transloco,
              newEmail !== null && !emailInitiated
                ? 'auth.profile.errorEmailChangeFailed'
                : 'auth.profile.errorUpdateFailed'
            )
          );
        }
      });
  }

  /**
   * An account created through a provider proves itself by completing a round
   * trip at that provider, which is a full page load. Anything else the user
   * typed is therefore saved BEFORE leaving, so the redirect never discards it.
   *
   * A first password in the same submit is refused rather than handled: saving
   * it ends the session, which would leave the round trip authenticating a
   * session that no longer exists. Saving it alone also makes the account one
   * that holds a password, so the ordinary path serves the next attempt.
   */
  #startReauthForEmailChange(
    newEmail: string,
    updateData: UpdateProfile | null
  ): void {
    if (this.profileModel().password.trim()) {
      this.error.set(
        this.#transloco.translate('auth.profile.errorPasswordBeforeEmail')
      );
      return;
    }

    const provider = this.reauthProvider();
    if (!provider) {
      this.error.set(
        this.#transloco.translate('auth.profile.errorReauthNoProvider')
      );
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const ops: Observable<unknown>[] = [];
    if (updateData) {
      ops.push(
        this.#authService.updateProfile(updateData).pipe(
          tap((user) => {
            this.user.set(user);
          })
        )
      );
    }
    ops.push(
      defer(() =>
        this.#authService.initOAuthReauth(STEP_UP_OPERATION.EMAIL_CHANGE)
      )
    );

    concat(...ops)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        complete: () => {
          this.#sessionStorage.setItem(PENDING_EMAIL_KEY, newEmail);
          this.#notify.info('auth.profile.reauthRedirecting', {
            provider: this.reauthProviderLabel()
          });
          if (this.#window) {
            this.#window.location.href = OAUTH_URLS[provider];
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

  /**
   * The first password on an account created through a provider needs the same
   * fresh proof of identity an email change needs, and the round trip is a full
   * page load. The name fields are therefore saved before leaving, exactly as
   * the email path saves them.
   *
   * The password itself is NOT carried across: a credential in session storage
   * would be readable by any script on the origin, and the round trip exists to
   * make a stolen session unable to bind one. The user types it again on
   * return, which the resume notice asks for.
   */
  #startReauthForPasswordSet(): void {
    const provider = this.reauthProvider();
    if (!provider) {
      this.error.set(
        this.#transloco.translate('auth.profile.errorReauthNoProvider')
      );
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const values = this.profileModel();
    const u = this.user();
    const nameChanged =
      !u || values.firstName !== u.firstName || values.lastName !== u.lastName;

    const ops: Observable<unknown>[] = [];
    if (nameChanged) {
      ops.push(
        this.#authService
          .updateProfile({
            firstName: values.firstName,
            lastName: values.lastName
          })
          .pipe(
            tap((user) => {
              this.user.set(user);
            })
          )
      );
    }
    ops.push(
      defer(() =>
        this.#authService.initOAuthReauth(STEP_UP_OPERATION.PASSWORD_SET)
      )
    );

    concat(...ops)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        complete: () => {
          this.#sessionStorage.setItem(PENDING_PASSWORD_KEY, true);
          this.#notify.info('auth.profile.reauthRedirecting', {
            provider: this.reauthProviderLabel()
          });
          if (this.#window) {
            this.#window.location.href = OAUTH_URLS[provider];
          }
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

  /**
   * Returns null only when an email change is in flight and no other field was
   * touched - without one, a submit always persists the personal fields, so a
   * revert-to-original edit still gets its confirmation.
   */
  #buildProfileUpdate(
    values: ProfileData,
    emailChanging: boolean
  ): UpdateProfile | null {
    const u = this.user();
    const passwordChanged = !!values.password.trim();
    const nameChanged =
      !u || values.firstName !== u.firstName || values.lastName !== u.lastName;

    if (emailChanging && !nameChanged && !passwordChanged) return null;

    const updateData: UpdateProfile = {
      firstName: values.firstName,
      lastName: values.lastName
    };

    if (passwordChanged) {
      updateData.password = values.password;
      updateData.currentPassword = values.currentPassword;
    }

    return updateData;
  }

  #successKey(emailChanging: boolean, profileSaved: boolean): string {
    if (!emailChanging) return 'auth.profile.successUpdated';
    return profileSaved
      ? 'auth.profile.emailChangeInitiatedWithProfile'
      : 'auth.profile.emailChangeInitiated';
  }

  /**
   * The email field goes back to the stored address on purpose: a requested
   * change is not applied until the user confirms it from the link.
   */
  #applySavedProfile(savedUser: UserResponse | null): void {
    if (savedUser) this.user.set(savedUser);

    const current = this.user();
    if (!current) return;

    this.profileModel.set({
      email: current.email,
      firstName: current.firstName,
      lastName: current.lastName,
      currentPassword: '',
      password: '',
      confirmPassword: ''
    });
    this.profileForm().reset();
  }
}
