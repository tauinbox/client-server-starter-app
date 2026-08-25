import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  inject
} from '@angular/core';
import { Router } from '@angular/router';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { AuthStore } from '../../store/auth.store';
import { AuthService } from '../../services/auth.service';
import { SessionStorageService } from '@core/services/session-storage.service';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { safeReturnUrl } from '../../utils/safe-return-url';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'nxs-oauth-callback',
  imports: [MatProgressSpinner, TranslocoDirective],
  template: `
    <div class="oauth-callback-container" *transloco="let t; scope: 'auth'">
      <mat-spinner></mat-spinner>
      <p>{{ t('auth.oauthCallback.completingSignIn') }}</p>
    </div>
  `,
  styles: `
    .oauth-callback-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 50vh;
      gap: 16px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OAuthCallbackComponent implements OnInit {
  readonly #router = inject(Router);
  readonly #authStore = inject(AuthStore);
  readonly #authService = inject(AuthService);
  readonly #sessionStorage = inject(SessionStorageService);
  readonly #window = inject(DOCUMENT).defaultView;

  ngOnInit(): void {
    this.#authService.exchangeOAuthData().subscribe({
      next: (authResponse) => {
        if (
          !authResponse.tokens?.access_token ||
          !authResponse.user?.id ||
          !authResponse.user?.email
        ) {
          this.#redirectToLogin('auth_failed');
          return;
        }

        this.#authStore.saveAuthResponse(authResponse);

        const returnUrl =
          this.#sessionStorage.getItem<string>('oauth_return_url');
        this.#sessionStorage.removeItem('oauth_return_url');

        const safeUrl =
          safeReturnUrl(returnUrl, this.#window?.location.origin) ??
          `/${AppRouteSegmentEnum.Profile}`;

        // Navigate only once the permissions are in: a guarded destination
        // evaluates its guard against the ability this call populates.
        void this.#authService
          .completeAuthentication()
          .then(() => this.#router.navigateByUrl(safeUrl, { replaceUrl: true }))
          // The spinner is this component's only state, so an unhandled
          // rejection would leave the user on it forever.
          .catch(() => this.#redirectToLogin('auth_failed'));
      },
      error: () => {
        this.#redirectToLogin('auth_failed');
      }
    });
  }

  #redirectToLogin(error: string): void {
    void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`], {
      queryParams: { oauth_error: error },
      replaceUrl: true
    });
  }
}
