import { inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpContext } from '@angular/common/http';
import type { Observable, Subscription } from 'rxjs';
import {
  finalize,
  firstValueFrom,
  from,
  shareReplay,
  switchMap,
  timer
} from 'rxjs';
import { Router } from '@angular/router';
import type { AuthResponse, TokensResponse } from '../models/auth.types';
import { AuthStore } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import { navigateToLogin } from '../utils/navigate-to-login';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';

const TOKEN_REFRESH_WINDOW_SECONDS = 60;
const REFRESH_LOCK_NAME = 'auth_token_refresh';

const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

@Injectable({ providedIn: 'root' })
export class TokenService {
  readonly #http = inject(HttpClient);
  readonly #router = inject(Router);
  readonly #authStore = inject(AuthStore);
  readonly #window = inject(DOCUMENT).defaultView;

  #refreshSubscription: Subscription | undefined;
  #refreshInFlight$: Observable<TokensResponse | null> | null = null;

  refreshTokens(): Observable<TokensResponse | null> {
    if (this.#refreshInFlight$) {
      return this.#refreshInFlight$;
    }

    this.#refreshInFlight$ = from(this.#acquireRefreshLock()).pipe(
      finalize(() => {
        this.#refreshInFlight$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return this.#refreshInFlight$;
  }

  scheduleTokenRefresh(): void {
    this.#refreshSubscription?.unsubscribe();

    const expiryTime = this.#authStore.getTokenExpiryTime();
    if (!expiryTime) return;

    const now = Date.now();

    // Token already expired — no point in scheduling, let guards/interceptor handle refresh
    if (expiryTime <= now) return;

    const timeToRefresh =
      expiryTime - now - TOKEN_REFRESH_WINDOW_SECONDS * 1000;

    const handleRefreshResult = {
      next: (tokens: TokensResponse | null) => {
        if (!tokens) this.forceLogout(this.#router.url);
      },
      error: () => this.forceLogout(this.#router.url)
    };

    if (timeToRefresh <= 0) {
      this.#refreshSubscription =
        this.refreshTokens().subscribe(handleRefreshResult);
      return;
    }

    this.#refreshSubscription = timer(timeToRefresh)
      .pipe(switchMap(() => this.refreshTokens()))
      .subscribe(handleRefreshResult);
  }

  cancelRefresh(): void {
    this.#refreshSubscription?.unsubscribe();
    this.#refreshInFlight$ = null;
  }

  /**
   * Clears the local session and navigates to login without making an HTTP call.
   * Used when the server has already invalidated the tokens (e.g. after a failed refresh).
   */
  forceLogout(returnUrl?: string): void {
    this.cancelRefresh();
    this.#authStore.clearSession();

    if (returnUrl) {
      navigateToLogin(this.#router, returnUrl);
    } else {
      void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`]);
    }
  }

  /**
   * Acquires a cross-tab Web Locks API lock before refreshing.
   * Falls back to a direct refresh when the API is unavailable (e.g. SSR, old browsers).
   *
   * `navigator` is accessed via `inject(DOCUMENT).defaultView` (Angular DI) rather
   * than as a bare global, so this works correctly in SSR and test environments.
   */
  #acquireRefreshLock(): Promise<TokensResponse | null> {
    const win = this.#window;

    if (!win || !('locks' in win.navigator)) {
      return this.#doRefresh();
    }

    // Wrap in an explicit Promise to prevent TypeScript from inferring a nested
    // Promise type from LockManager.request's generic overload.
    return new Promise<TokensResponse | null>((resolve, reject) => {
      win.navigator.locks
        .request(REFRESH_LOCK_NAME, async () => {
          try {
            resolve(await this.#doRefresh());
          } catch (err) {
            reject(err);
          }
        })
        .catch(reject);
    });
  }

  /**
   * Performs the token refresh by sending an empty POST body.
   * The refresh token is sent automatically as an HttpOnly cookie.
   */
  async #doRefresh(): Promise<TokensResponse | null> {
    const response = await firstValueFrom(
      this.#http.post<AuthResponse>(
        AuthApiEnum.RefreshToken,
        {},
        { context: silentContext(), withCredentials: true }
      )
    );

    this.#authStore.saveAuthResponse(response);
    this.scheduleTokenRefresh();
    return response.tokens;
  }
}
