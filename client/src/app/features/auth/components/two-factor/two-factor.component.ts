import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
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

/**
 * The enrolment is a strict sequence, and each step needs the answer of the
 * one before it: the secret comes from `setup`, the recovery codes from
 * `enable`. A single state signal keeps an impossible pair off the screen.
 */
type Stage = 'idle' | 'password' | 'confirm' | 'codes' | 'disable';

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

  /** Tells the profile page to reload, so the card reflects the new state. */
  readonly changed = output<void>();

  protected readonly stage = signal<Stage>('idle');
  protected readonly busy = signal(false);
  protected readonly setup = signal<MfaSetupResponse | null>(null);
  protected readonly recoveryCodes = signal<string[]>([]);

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

  startEnrolment(): void {
    this.#reset();
    this.stage.set('password');
  }

  startDisable(): void {
    this.#reset();
    this.stage.set('disable');
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
    if (this.passwordForm().invalid() || this.busy()) return;

    this.busy.set(true);
    this.#authService
      .disableMfa({ currentPassword: this.passwordModel().currentPassword })
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

  /** The codes are readable once, so leaving the panel is a deliberate act. */
  acknowledgeCodes(): void {
    this.recoveryCodes.set([]);
    this.stage.set('idle');
    this.changed.emit();
  }

  #reset(): void {
    this.setup.set(null);
    this.recoveryCodes.set([]);
    this.passwordModel.set({ currentPassword: '' });
    this.codeModel.set({ code: '' });
  }
}
