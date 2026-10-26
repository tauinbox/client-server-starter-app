import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, take } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';

export type MailedTokenAction = 'verifyEmail' | 'confirmEmailChange';

const KEY_PREFIX: Record<MailedTokenAction, string> = {
  verifyEmail: 'auth.verifyEmail.',
  confirmEmailChange: 'auth.confirmEmailChange.'
};

@Component({
  selector: 'nxs-mailed-token',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatIcon,
    MatButton,
    MatProgressSpinner,
    RouterLink,
    TranslocoDirective
  ],
  templateUrl: './mailed-token.component.html',
  styleUrl: './mailed-token.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MailedTokenComponent implements OnInit {
  readonly #authService = inject(AuthService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #transloco = inject(TranslocoService);

  readonly action = input.required<MailedTokenAction>();
  readonly token = input<string>();

  protected readonly keyPrefix = computed(() => KEY_PREFIX[this.action()]);
  protected readonly loading = signal(true);
  protected readonly success = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    // The messages come from the lazily fetched `auth` scope, and translate()
    // answers with the key itself until it lands. A cached scope emits at once.
    this.#transloco
      .load(`auth/${this.#transloco.getActiveLang()}`)
      .pipe(
        take(1),
        catchError(() => of(null)),
        takeUntilDestroyed(this.#destroyRef)
      )
      .subscribe(() => this.#submit());
  }

  #submit(): void {
    const token = this.token();
    const prefix = this.keyPrefix();

    if (!token) {
      this.loading.set(false);
      this.error.set(this.#transloco.translate(prefix + 'errorNoToken'));
      return;
    }

    const request$ =
      this.action() === 'verifyEmail'
        ? this.#authService.verifyEmail(token)
        : this.#authService.confirmEmailChange(token);

    request$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe({
      next: () => {
        this.loading.set(false);
        this.success.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(
          parseHttpErrorMessage(err, this.#transloco, prefix + 'errorFailed')
        );
      }
    });
  }
}
