import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  inject,
  signal
} from '@angular/core';
import { Router } from '@angular/router';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import { SessionStorageService } from '@core/services/session-storage.service';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { safeReturnUrl } from '../../utils/safe-return-url';
import { OAUTH_ERROR_CANCELLED } from '../../constants/oauth-error.const';
import { OAUTH_RETURN_URL_KEY } from '../../constants/oauth-return-url.const';
import { MfaChallengeComponent } from '../mfa-challenge/mfa-challenge.component';
import type { MfaRequiredResponse } from '../../models/auth.types';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'nxs-oauth-callback',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatProgressSpinner,
    MfaChallengeComponent,
    TranslocoDirective
  ],
  templateUrl: './oauth-callback.component.html',
  styleUrl: './oauth-callback.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OAuthCallbackComponent implements OnInit {
  readonly #router = inject(Router);
  readonly #authService = inject(AuthService);
  readonly #sessionStorage = inject(SessionStorageService);
  readonly #window = inject(DOCUMENT).defaultView;

  /**
   * The challenge the provider round trip bought on an account that carries a
   * second factor. It is held here and nowhere else: the token authorizes one
   * operation, so it must not reach the router state or any storage.
   */
  protected readonly mfaChallenge = signal<MfaRequiredResponse | null>(null);

  ngOnInit(): void {
    this.#authService.exchangeOAuthData().subscribe({
      next: (response) => {
        // The provider proved one credential only. The sign-in finishes when a
        // code is presented, so nothing is saved and no navigation happens yet.
        if ('mfaRequired' in response) {
          this.mfaChallenge.set(response);
          return;
        }

        this.#navigateToReturnUrl();
      },
      // The spinner is this component's only state, so every failure,
      // including an incomplete response, must leave it for /login.
      error: () => {
        this.#redirectToLogin('auth_failed');
      }
    });
  }

  /**
   * The code finished the sign-in, and `verifyMfa` already saved the session
   * and populated the permissions, so only the destination is left.
   */
  onMfaVerified(): void {
    this.#navigateToReturnUrl();
  }

  /** No password form to fall back to here, so the sign-in restarts. */
  onMfaCancelled(): void {
    this.#redirectToLogin(OAUTH_ERROR_CANCELLED);
  }

  onMfaExpired(): void {
    this.#redirectToLogin('auth_failed');
  }

  #navigateToReturnUrl(): void {
    const returnUrl =
      this.#sessionStorage.getItem<string>(OAUTH_RETURN_URL_KEY);
    this.#sessionStorage.removeItem(OAUTH_RETURN_URL_KEY);

    const safeUrl =
      safeReturnUrl(returnUrl, this.#window?.location.origin) ??
      `/${AppRouteSegmentEnum.Profile}`;

    void this.#router.navigateByUrl(safeUrl, { replaceUrl: true });
  }

  #redirectToLogin(error: string): void {
    void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`], {
      queryParams: { oauth_error: error },
      replaceUrl: true
    });
  }
}
