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
import { DatePipe } from '@angular/common';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { HttpErrorResponse } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { TranslocoDirective } from '@jsverse/transloco';
import type { ActiveSessionResponse, UserResponse } from '@app/shared/types';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { NotifyService } from '@core/services/notify.service';
import { AuthService } from '../../services/auth.service';
import { describeUserAgent } from '../../utils/describe-user-agent';
import {
  createStepUpFactorForm,
  stepUpFactorOf
} from '../../utils/step-up-factor-form';
import type {
  MfaStepUpRequest,
  SessionRevokeTarget
} from '../../models/auth.types';

/** A session row as the card shows it. */
type SessionRow = ActiveSessionResponse & {
  browser: string | null;
  os: string | null;
};

/**
 * Which factor ends a session for this account. `provider` has no field: the
 * page sends the user to the provider and the card resumes on the way back.
 */
type StepUpFactor = 'password' | 'code' | 'provider';

@Component({
  selector: 'nxs-active-sessions',
  imports: [
    DatePipe,
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
  templateUrl: './active-sessions.component.html',
  styleUrl: './active-sessions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActiveSessionsComponent {
  readonly #authService = inject(AuthService);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);

  readonly user = input<UserResponse | null>(null);

  /** Label of the provider a step-up round trip can run against. */
  readonly reauthProviderLabel = input('');

  /** The change a provider round trip was taken for, on the load after it. */
  readonly resumeRevoke = input<SessionRevokeTarget | null>(null);

  /**
   * True after the user changed a sign-in method. A device that was signed in
   * with the old one keeps its session, so the card offers to end the others.
   */
  readonly offerSignOutOthers = input(false);

  /** Asks the page to take an account with no password through its provider. */
  readonly reauthRequested = output<SessionRevokeTarget>();

  protected readonly sessions = signal<SessionRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly busy = signal(false);

  /** The change the open step-up prompt authorises. Null when none is open. */
  protected readonly pending = signal<SessionRevokeTarget | null>(null);

  protected readonly otherSessions = computed(() =>
    this.sessions().filter((s) => !s.current)
  );

  readonly #stepUpFactor = computed(() => stepUpFactorOf(this.user()));

  protected readonly factor = computed<StepUpFactor>(() => {
    const factor = this.#stepUpFactor();
    return factor === 'none' ? 'provider' : factor;
  });

  /** An account with no password and no linked provider cannot prove itself. */
  protected readonly cannotStepUp = computed(
    () => this.factor() === 'provider' && !this.reauthProviderLabel()
  );

  readonly #stepUp = createStepUpFactorForm(this.#stepUpFactor, {
    passwordRequired: 'auth.sessions.passwordRequired',
    codeRequired: 'auth.sessions.codeRequired'
  });
  readonly passwordModel = this.#stepUp.passwordModel;
  readonly passwordForm = this.#stepUp.passwordForm;
  readonly codeModel = this.#stepUp.codeModel;
  readonly codeForm = this.#stepUp.codeForm;

  protected readonly stepUpBlocked = computed(
    () => this.#stepUp.invalid() || this.busy()
  );

  /** A resumed round trip sends one request, however often the input emits. */
  #resumed = false;

  constructor() {
    this.load();

    effect(() => {
      const target = this.resumeRevoke();
      if (!target || this.#resumed) return;
      this.#resumed = true;
      this.#revoke(target, {});
    });
  }

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.#authService
      .getSessions()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (sessions) => {
          this.sessions.set(
            sessions.map((s) => ({ ...s, ...describeUserAgent(s.userAgent) }))
          );
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadFailed.set(true);
        }
      });
  }

  startRevoke(target: SessionRevokeTarget): void {
    this.#resetFactors();

    if (this.factor() === 'provider') {
      this.reauthRequested.emit(target);
      return;
    }

    this.pending.set(target);
  }

  cancel(): void {
    this.#resetFactors();
    this.pending.set(null);
  }

  confirm(): void {
    const target = this.pending();
    if (!target || this.stepUpBlocked()) return;

    this.#revoke(target, this.#stepUp.request());
  }

  #revoke(target: SessionRevokeTarget, request: MfaStepUpRequest): void {
    const request$: Observable<unknown> =
      target.scope === 'one'
        ? this.#authService.revokeSession(target.sessionId, request)
        : this.#authService.revokeOtherSessions(request);

    this.busy.set(true);
    request$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.cancel();
        this.#notify.success(
          target.scope === 'one'
            ? 'auth.sessions.endedOne'
            : 'auth.sessions.endedOthers'
        );
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.#notify.error(err, 'auth.sessions.errorEndFailed');
        // A 404 means the session ended on its own in the meantime.
        if (err.status === 404) this.load();
      }
    });
  }

  #resetFactors(): void {
    this.#stepUp.reset();
  }
}
