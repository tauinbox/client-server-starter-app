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
import { OAuthIntentService } from '../../services/oauth-intent.service';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { safeReturnUrl } from '../../utils/safe-return-url';
import { MfaChallengeComponent } from '../mfa-challenge/mfa-challenge.component';
import {
  OAuthResidenceComponent,
  type ResidenceRegionMove
} from '../oauth-residence/oauth-residence.component';
import type { MfaRequiredResponse } from '../../models/auth.types';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  HOME_DATA_REGION,
  OAUTH_ERROR,
  type CountryCode,
  type OAuthError
} from '@app/shared/constants';
import { AuthStore } from '../../store/auth.store';
import type { OAuthIntent } from '../../services/oauth-intent.service';

@Component({
  selector: 'nxs-oauth-callback',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatProgressSpinner,
    MfaChallengeComponent,
    OAuthResidenceComponent,
    TranslocoDirective
  ],
  templateUrl: './oauth-callback.component.html',
  styleUrl: './oauth-callback.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OAuthCallbackComponent implements OnInit {
  readonly #router = inject(Router);
  readonly #authService = inject(AuthService);
  readonly #oauthIntent = inject(OAuthIntentService);
  readonly #authStore = inject(AuthStore);
  readonly #window = inject(DOCUMENT).defaultView;
  #intent: OAuthIntent | null = null;

  /**
   * The challenge the provider round trip bought on an account that carries a
   * second factor. It is held here and nowhere else: the token authorizes one
   * operation, so it must not reach the router state or any storage.
   */
  protected readonly mfaChallenge = signal<MfaRequiredResponse | null>(null);

  /** No account holds the provider identity until the user declares a country. */
  protected readonly residenceRequired = signal(false);
  protected readonly declaredCountry = signal<CountryCode | null>(null);

  ngOnInit(): void {
    const intent = this.#oauthIntent.take();

    if (intent === null) {
      // This tab did not start the round trip, so it signs nobody in.
      this.#redirectToLogin(OAUTH_ERROR.AUTH_FAILED);

      return;
    }

    this.#intent = intent;
    this.declaredCountry.set(intent.residenceCountry ?? null);
    // The provider returned to the API host of this region, which holds the
    // result, and the code or the country of the next step goes there too.
    this.#authStore.setSignInRegion(intent.region);

    this.#authService.exchangeOAuthData().subscribe({
      next: (response) => {
        // The provider proved one credential only. The sign-in finishes when a
        // code is presented, so nothing is saved and no navigation happens yet.
        if ('mfaRequired' in response) {
          this.mfaChallenge.set(response);

          return;
        }

        if ('residenceRequired' in response) {
          this.residenceRequired.set(true);

          return;
        }

        this.#navigateToReturnUrl();
      },
      // The spinner is this component's only state, so every failure,
      // including an incomplete response, must leave it for /login.
      error: () => {
        this.#redirectToLogin(OAUTH_ERROR.AUTH_FAILED);
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
    this.#redirectToLogin(OAUTH_ERROR.CANCELLED);
  }

  onMfaExpired(): void {
    this.#redirectToLogin(OAUTH_ERROR.AUTH_FAILED);
  }

  /** `completeOAuthSignup` already saved the session. */
  onSignedUp(): void {
    this.#navigateToReturnUrl();
  }

  onResidenceCancelled(): void {
    this.#redirectToLogin(OAUTH_ERROR.CANCELLED);
  }

  onResidenceFailed(error: OAuthError): void {
    this.#redirectToLogin(error);
  }

  /**
   * The provider profile waits in a host-only cookie of this host, so the
   * account of another region starts the round trip again on its host.
   */
  onResidenceRegionMoved({
    region,
    residenceCountry
  }: ResidenceRegionMove): void {
    if (!this.#intent) return;

    const { provider, returnUrl } = this.#intent;

    this.#authStore.setSignInRegion(region);
    this.#authService.startOAuth(provider, { returnUrl, residenceCountry });
  }

  #navigateToReturnUrl(): void {
    const safeUrl =
      safeReturnUrl(
        this.#intent?.returnUrl ?? null,
        this.#window?.location.origin
      ) ?? `/${AppRouteSegmentEnum.Profile}`;

    void this.#router.navigateByUrl(safeUrl, { replaceUrl: true });
  }

  #redirectToLogin(error: OAuthError): void {
    // The sign-in of /login starts in the home region.
    this.#authStore.setSignInRegion(HOME_DATA_REGION);
    void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`], {
      queryParams: { oauth_error: error },
      replaceUrl: true
    });
  }
}
