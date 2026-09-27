import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { form, required } from '@angular/forms/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { HttpErrorResponse } from '@angular/common/http';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { OAUTH_PROVIDER_FLAGS, STEP_UP_OPERATION } from '@app/shared/constants';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { OAuthIntentService } from '../../services/oauth-intent.service';
import { NotifyService } from '@core/services/notify.service';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { AuthService } from '../../services/auth.service';
import {
  isOAuthProvider,
  OAUTH_PROVIDER_LABEL_KEYS,
  OAUTH_URLS,
  type OAuthProvider
} from '../../constants/auth-api.const';

export type LinkedAccount = {
  provider: string;
  createdAt: string;
};

/** A link or an unlink, which is what a step-up round trip is taken for here. */
export type ProviderChange = {
  operation:
    typeof STEP_UP_OPERATION.OAUTH_LINK | typeof STEP_UP_OPERATION.OAUTH_UNLINK;
  provider: OAuthProvider;
};

/** Which credential change the open password prompt authorises. */
type StepUpPromptMode = 'link' | 'unlink';

@Component({
  selector: 'nxs-linked-providers',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatButton,
    MatIcon,
    MatProgressSpinner,
    NxsFormFieldComponent,
    PasswordToggleComponent,
    TranslocoDirective
  ],
  templateUrl: './linked-providers.component.html',
  styleUrl: './linked-providers.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LinkedProvidersComponent {
  readonly #authService = inject(AuthService);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #oauthIntent = inject(OAuthIntentService);
  readonly #window = inject(DOCUMENT).defaultView;
  readonly #transloco = inject(TranslocoService);
  readonly #flagsStore = inject(FeatureFlagsStore);

  /** The page owns the list, because its email and password flows read it too. */
  readonly accounts = input<LinkedAccount[]>([]);

  /** False only for an account created through a provider. */
  readonly hasPassword = input(true);

  /** The change a completed round trip was taken for, on the load after it. */
  readonly resumeChange = input<ProviderChange | null>(null);

  /**
   * True while a request is out. The page sets it too, while the round trip it
   * runs for this card is starting.
   */
  readonly busy = model(false);

  /** Asks the page to take an account with no password through its provider. */
  readonly reauthRequested = output<ProviderChange>();

  /** The provider is gone from the account, so the page drops it from its list. */
  readonly unlinked = output<OAuthProvider>();

  // A provider is shown when its public flag resolves true (server-gated on the
  // provider being configured) OR the user already has it linked - so a stale
  // link to a now-unconfigured provider can still be removed. The whole card
  // is hidden when none qualify.
  protected readonly visibleProviders = computed(() => {
    const flags = this.#flagsStore.flags();
    const linked = new Set(this.accounts().map((a) => a.provider));
    return OAUTH_PROVIDER_FLAGS.filter(
      (p) => flags[p.flagKey] === true || linked.has(p.provider)
    ).map((p) => p.provider);
  });

  /**
   * The provider whose step-up prompt is waiting for the password, and the
   * change that prompt authorises. Null when no prompt is open: one prompt at
   * a time, because one credential change at a time.
   */
  protected readonly stepUpPrompt = signal<{
    provider: OAuthProvider;
    mode: StepUpPromptMode;
  } | null>(null);

  protected readonly stepUpPromptLabel = computed(() => {
    const prompt = this.stepUpPrompt();
    return prompt ? this.#providerLabel(prompt.provider) : '';
  });

  readonly stepUpPasswordModel = signal<{ currentPassword: string }>({
    currentPassword: ''
  });

  readonly stepUpPasswordForm = form(this.stepUpPasswordModel, (path) => {
    required(path.currentPassword, {
      message: 'auth.profile.stepUpPasswordRequired'
    });
  });

  /** A resumed round trip sends one request, however often the input emits. */
  #resumed = false;

  constructor() {
    effect(() => {
      const change = this.resumeChange();
      if (!change || this.#resumed) return;
      this.#resumed = true;
      // The proof the trip earned is in place, so a link can start at the
      // provider the user picked before leaving, and an unlink needs no second
      // trip.
      if (change.operation === STEP_UP_OPERATION.OAUTH_LINK) {
        this.#startLink(change.provider);
      } else {
        this.#unlink(change.provider);
      }
    });
  }

  isProviderLinked(provider: string): boolean {
    return this.accounts().some((a) => a.provider === provider);
  }

  /**
   * A link plants a credential the account owner cannot revoke by changing
   * their password, so it asks for a factor first. An account that holds a
   * password types it here; an account created through a provider proves
   * itself at that provider, which is a round trip of its own before the one
   * that does the linking.
   */
  connectProvider(provider: string): void {
    if (!isOAuthProvider(provider)) return;

    if (this.hasPassword()) {
      this.#openStepUpPrompt(provider, 'link');
      return;
    }

    this.reauthRequested.emit({
      operation: STEP_UP_OPERATION.OAUTH_LINK,
      provider
    });
  }

  /**
   * The row an unlink deletes is a sign-in credential that a password change
   * does not revoke, so removing one costs the factor that adding one costs.
   * An account that holds a password types it here; an account created through
   * a provider proves itself at a provider it still holds.
   */
  disconnectProvider(provider: string): void {
    if (!isOAuthProvider(provider)) return;

    if (this.hasPassword()) {
      this.#openStepUpPrompt(provider, 'unlink');
      return;
    }

    this.reauthRequested.emit({
      operation: STEP_UP_OPERATION.OAUTH_UNLINK,
      provider
    });
  }

  /** The password prompt on the provider controls, answered. */
  protected confirmStepUp(): void {
    const prompt = this.stepUpPrompt();
    if (!prompt || this.stepUpPasswordForm().invalid() || this.busy()) {
      return;
    }

    const currentPassword = this.stepUpPasswordModel().currentPassword;

    if (prompt.mode === 'link') {
      this.#startLink(prompt.provider, currentPassword);
      return;
    }

    this.#unlink(prompt.provider, currentPassword);
  }

  protected cancelStepUp(): void {
    this.#closeStepUpPrompt();
  }

  #openStepUpPrompt(provider: OAuthProvider, mode: StepUpPromptMode): void {
    this.stepUpPasswordModel.set({ currentPassword: '' });
    this.stepUpPrompt.set({ provider, mode });
  }

  #closeStepUpPrompt(): void {
    this.stepUpPrompt.set(null);
    this.stepUpPasswordModel.set({ currentPassword: '' });
  }

  #startLink(provider: OAuthProvider, currentPassword?: string): void {
    this.busy.set(true);
    this.#authService
      .initOAuthLink(currentPassword)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#closeStepUpPrompt();
          this.#oauthIntent.start('/profile');
          if (this.#window) {
            this.#window.location.href = OAUTH_URLS[provider];
          }
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.#notify.error(err, 'auth.profile.errorInitiateLinkFailed');
        }
      });
  }

  #unlink(provider: OAuthProvider, currentPassword?: string): void {
    this.busy.set(true);
    this.#authService
      .unlinkOAuthAccount(provider, currentPassword)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.#closeStepUpPrompt();
          this.unlinked.emit(provider);
          this.#notify.success('auth.profile.oauthDisconnected', {
            provider: this.#providerLabel(provider)
          });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.#notify.error(err, 'auth.profile.errorDisconnectFailed');
        }
      });
  }

  #providerLabel(provider: OAuthProvider): string {
    return this.#transloco.translate(OAUTH_PROVIDER_LABEL_KEYS[provider]);
  }
}
