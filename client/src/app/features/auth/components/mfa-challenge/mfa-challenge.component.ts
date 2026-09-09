import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { form, required } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import { ErrorKeys } from '@app/shared/constants';
import { AuthService } from '../../services/auth.service';
import type { MfaRequiredResponse } from '../../models/auth.types';

/**
 * The code step of a sign-in, shared by the two ways in: the password card and
 * the provider callback. Both reach the same server routes with the same
 * pending token, so the step belongs to neither card.
 *
 * The token stays in this component rather than in the router state or in
 * storage: it is a bearer credential for one operation, and a route parameter
 * would leave it in the history of the browser.
 */
@Component({
  selector: 'nxs-mfa-challenge',
  imports: [
    NxsFormFieldComponent,
    MatButton,
    MatProgressSpinner,
    TranslocoDirective
  ],
  templateUrl: './mfa-challenge.component.html',
  styleUrl: './mfa-challenge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MfaChallengeComponent {
  readonly #authService = inject(AuthService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #translocoService = inject(TranslocoService);

  readonly challenge = input.required<MfaRequiredResponse>();

  /** The code was accepted, so the session is live and populated. */
  readonly verified = output<void>();

  /** The user chose to go back to the card that started the sign-in. */
  readonly cancelled = output<void>();

  /**
   * The pending token died, so a code can no longer finish this sign-in. The
   * payload is the message the host puts in front of the user.
   */
  readonly expired = output<string>();

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly usingRecoveryCode = signal(false);

  readonly codeModel = signal<{ code: string }>({ code: '' });
  readonly codeForm = form(this.codeModel, (path) => {
    required(path.code, { message: 'auth.login.mfaCodeRequired' });
  });

  onSubmit(): void {
    if (this.codeForm().invalid()) return;

    this.loading.set(true);
    this.error.set(null);

    const mfaToken = this.challenge().mfaToken;
    const code = this.codeModel().code.trim();
    const request$ = this.usingRecoveryCode()
      ? this.#authService.verifyMfaRecoveryCode(mfaToken, code)
      : this.#authService.verifyMfa(mfaToken, code);

    request$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe({
      next: () => {
        this.loading.set(false);
        this.verified.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.#handleError(err);
      }
    });
  }

  toggleRecoveryCode(): void {
    this.usingRecoveryCode.update((using) => !using);
    this.codeModel.set({ code: '' });
    this.error.set(null);
  }

  cancel(): void {
    this.cancelled.emit();
  }

  /**
   * An expired challenge cannot be retried with a code, so the host takes the
   * user back rather than leaving them typing into a dead field.
   */
  #handleError(err: HttpErrorResponse): void {
    if (err.error?.errorKey === ErrorKeys.AUTH.MFA_INVALID_PENDING_TOKEN) {
      this.expired.emit(
        this.#resolveErrorMessage(err, 'errors.auth.mfaInvalidPendingToken')
      );
      return;
    }

    this.error.set(
      this.#resolveErrorMessage(
        err,
        this.usingRecoveryCode()
          ? 'errors.auth.mfaInvalidRecoveryCode'
          : 'errors.auth.mfaInvalidCode'
      )
    );
  }

  #resolveErrorMessage(err: HttpErrorResponse, fallbackKey: string): string {
    return parseHttpErrorMessage(err, this.#translocoService, fallbackKey);
  }
}
