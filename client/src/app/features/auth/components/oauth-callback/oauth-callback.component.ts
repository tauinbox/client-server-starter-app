import type { OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { AuthStore } from '../../store/auth.store';
import { AuthService } from '../../services/auth.service';
import { SessionStorageService } from '@core/services/session-storage.service';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';

@Component({
  selector: 'app-oauth-callback',
  imports: [MatProgressSpinner],
  template: `
    <div class="oauth-callback-container">
      <mat-spinner></mat-spinner>
      <p>Completing sign in...</p>
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
        this.#authService.scheduleTokenRefresh();

        const returnUrl =
          this.#sessionStorage.getItem<string>('oauth_return_url');
        this.#sessionStorage.removeItem('oauth_return_url');

        const safeUrl =
          returnUrl && returnUrl.startsWith('/') && !returnUrl.includes('//')
            ? returnUrl
            : `/${AppRouteSegmentEnum.Profile}`;

        void this.#router.navigateByUrl(safeUrl, { replaceUrl: true });
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
