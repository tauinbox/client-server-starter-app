import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
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
import { TranslocoDirective } from '@jsverse/transloco';
import type { MfaSetupResponse, UserResponse } from '@app/shared/types';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { NotifyService } from '@core/services/notify.service';
import { AuthService } from '../../services/auth.service';
import type { MfaStepUpRequest } from '../../models/auth.types';

/**
 * The enrolment is a strict sequence, and each step needs the answer of the
 * one before it: the secret comes from `setup`, the recovery codes from
 * `enable`. A single state signal keeps an impossible pair off the screen.
 */
type Stage =
  'idle' | 'password' | 'confirm' | 'codes' | 'disable' | 'regenerate';

@Component({
  selector: 'nxs-two-factor',
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
  templateUrl: './two-factor.component.html',
  styleUrl: './two-factor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TwoFactorComponent {
  readonly #authService = inject(AuthService);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);

  readonly user = input<UserResponse | null>(null);

  /**
   * Label of the provider a step-up round trip can run against. It is empty
   * only when the page found none, which is the one state an account with no
   * password can do nothing from.
   */
  readonly reauthProviderLabel = input('');

  /** True on the load that follows a round trip taken for this enrolment. */
  readonly resumeSetup = input(false);

  /** Tells the profile page to reload, so the card reflects the new state. */
  readonly changed = output<void>();

  /** Asks the page to take an account with no password through its provider. */
  readonly reauthRequested = output<void>();

  protected readonly stage = signal<Stage>('idle');
  protected readonly busy = signal(false);
  protected readonly setup = signal<MfaSetupResponse | null>(null);
  protected readonly recoveryCodes = signal<string[]>([]);

  /**
   * True when the codes on screen replaced an earlier set. The panel must say
   * so: the codes the user saved at enrolment stopped working just now.
   */
  protected readonly codesReplaced = signal(false);

  protected readonly enabled = computed(() => this.user()?.mfaEnabled === true);

  /**
   * An account created through a provider holds no password, so it cannot pass
   * the step-up this card asks for. It proves itself with a provider round
   * trip, which this card does not run.
   */
  protected readonly accountHasPassword = computed(
    () => this.user()?.hasPassword !== false
  );

  readonly passwordModel = signal<{ currentPassword: string }>({
    currentPassword: ''
  });
  readonly passwordForm = form(this.passwordModel, (path) => {
    required(path.currentPassword, {
      message: 'auth.twoFactor.passwordRequired'
    });
  });

  readonly codeModel = signal<{ code: string }>({ code: '' });
  readonly codeForm = form(this.codeModel, (path) => {
    required(path.code, { message: 'auth.twoFactor.codeRequired' });
  });

  /**
   * An account with no password proves itself with a code from the
   * authenticator it enrolled, which is the only factor it holds. Turning the
   * factor off and replacing the recovery set ask for the same proof.
   */
  protected readonly stepUpBlocked = computed(
    () =>
      (this.accountHasPassword()
        ? this.passwordForm().invalid()
        : this.codeForm().invalid()) || this.busy()
  );

  /** A resumed round trip asks for one secret, however often the input emits. */
  #resumed = false;

  constructor() {
    effect(() => {
      if (!this.resumeSetup() || this.#resumed) return;
      this.#resumed = true;
      this.#requestSecretWithProof();
    });
  }

  startEnrolment(): void {
    this.#reset();

    // An account with no password proves itself at its provider instead, and
    // the page owns that round trip.
    if (!this.accountHasPassword()) {
      this.reauthRequested.emit();
      return;
    }

    this.stage.set('password');
  }

  startDisable(): void {
    this.#reset();
    this.stage.set('disable');
  }

  startRegenerate(): void {
    this.#reset();
    this.stage.set('regenerate');
  }

  cancel(): void {
    this.#reset();
    this.stage.set('idle');
  }

  /** Step one: prove the caller, then ask the server for a secret. */
  requestSecret(): void {
    if (this.passwordForm().invalid() || this.busy()) return;

    this.busy.set(true);
    this.#authService
      .startMfaSetup(this.passwordModel().currentPassword)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (response) => {
          this.busy.set(false);
          this.passwordModel.set({ currentPassword: '' });
          this.setup.set(response);
          this.stage.set('confirm');
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.#notify.error(err, 'auth.twoFactor.errorSetupFailed');
        }
      });
  }

  /** Step two: a code from the app is what actually turns the factor on. */
  confirmCode(): void {
    if (this.codeForm().invalid() || this.busy()) return;

    this.busy.set(true);
    this.#authService
      .enableMfa(this.codeModel().code.trim())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (response) => {
          this.busy.set(false);
          this.codeModel.set({ code: '' });
          this.setup.set(null);
          this.recoveryCodes.set(response.recoveryCodes);
          this.stage.set('codes');
          this.#notify.success('auth.twoFactor.enabled');
          // The reload this emit asks for rebuilds the profile page and takes
          // this card with it, so it waits until the codes have been read.
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.#notify.error(err, 'auth.twoFactor.errorInvalidCode');
        }
      });
  }

  disable(): void {
    if (this.stepUpBlocked()) return;

    this.busy.set(true);
    this.#authService
      .disableMfa(this.#stepUpRequest())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.#reset();
          this.stage.set('idle');
          this.#notify.success('auth.twoFactor.disabled');
          this.changed.emit();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.#notify.error(err, 'auth.twoFactor.errorDisableFailed');
        }
      });
  }

  /**
   * Replaces the recovery set. The codes it returns are the only readable copy,
   * so they take over the same panel the enrolment ends on.
   */
  regenerateCodes(): void {
    if (this.stepUpBlocked()) return;

    this.busy.set(true);
    this.#authService
      .regenerateRecoveryCodes(this.#stepUpRequest())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (response) => {
          this.busy.set(false);
          this.passwordModel.set({ currentPassword: '' });
          this.codeModel.set({ code: '' });
          this.recoveryCodes.set(response.recoveryCodes);
          this.codesReplaced.set(true);
          this.stage.set('codes');
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.#notify.error(err, 'auth.twoFactor.errorRegenerateFailed');
        }
      });
  }

  /** The codes are readable once, so leaving the panel is a deliberate act. */
  acknowledgeCodes(): void {
    this.recoveryCodes.set([]);
    this.codesReplaced.set(false);
    this.stage.set('idle');
    this.changed.emit();
  }

  /**
   * The proof the round trip minted is an httpOnly cookie the page cannot
   * read, so this request carries no factor of its own.
   */
  #requestSecretWithProof(): void {
    this.busy.set(true);
    this.#authService
      .startMfaSetup()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (response) => {
          this.busy.set(false);
          this.setup.set(response);
          this.stage.set('confirm');
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.#notify.error(err, 'auth.twoFactor.errorSetupFailed');
        }
      });
  }

  /**
   * The factor is live in both paths that send this, so the account always
   * holds a code. The password is what an account that has one uses.
   */
  #stepUpRequest(): MfaStepUpRequest {
    return this.accountHasPassword()
      ? { currentPassword: this.passwordModel().currentPassword }
      : { code: this.codeModel().code.trim() };
  }

  #reset(): void {
    this.setup.set(null);
    this.recoveryCodes.set([]);
    this.codesReplaced.set(false);
    this.passwordModel.set({ currentPassword: '' });
    this.codeModel.set({ code: '' });
  }
}
