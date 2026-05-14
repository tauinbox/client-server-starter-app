import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

@Component({
  selector: 'nxs-verify-email',
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
  templateUrl: './verify-email.component.html',
  styleUrl: './verify-email.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class VerifyEmailComponent implements OnInit {
  readonly #authService = inject(AuthService);
  readonly #route = inject(ActivatedRoute);
  readonly #destroyRef = inject(DestroyRef);
  readonly #transloco = inject(TranslocoService);

  protected readonly loading = signal(true);
  protected readonly success = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const token = this.#route.snapshot.queryParams['token'];

    if (!token) {
      this.loading.set(false);
      this.error.set(
        this.#transloco.translate('auth.verifyEmail.errorNoToken')
      );
      return;
    }

    this.#authService
      .verifyEmail(token)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.success.set(true);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.error.set(
            err.error?.message ||
              this.#transloco.translate('auth.verifyEmail.errorFailed')
          );
        }
      });
  }
}
