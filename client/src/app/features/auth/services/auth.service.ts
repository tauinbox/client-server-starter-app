import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpContext } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { finalize, firstValueFrom, from, switchMap, tap } from 'rxjs';
import { Router } from '@angular/router';
import type { User } from '@shared/models/user.types';
import type { UserPermissionsResponse } from '@app/shared/types';
import type {
  AuthResponse,
  LoginCredentials,
  RegisterRequest,
  TokensResponse,
  UpdateProfile
} from '../models/auth.types';
import { AuthStore, AUTH_USER_KEY } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import { navigateToLogin } from '../utils/navigate-to-login';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { TokenService } from './token.service';
import { RbacMetadataService } from './rbac-metadata.service';
import { RbacMetadataStore } from '../store/rbac-metadata.store';
import { NotificationsService } from '@core/services/notifications.service';
import { FeatureFlagsStore } from '../../feature-flags/store/feature-flags.store';

const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly #http = inject(HttpClient);
  readonly #router = inject(Router);
  readonly #authStore = inject(AuthStore);
  readonly #tokenService = inject(TokenService);
  readonly #rbacMetadataService = inject(RbacMetadataService);
  readonly #rbacMetadataStore = inject(RbacMetadataStore);
  readonly #notificationsService = inject(NotificationsService);
  readonly #featureFlagsStore = inject(FeatureFlagsStore);
  readonly #destroyRef = inject(DestroyRef);

  readonly isAuthenticated = this.#authStore.isAuthenticated;

  constructor() {
    this.#notificationsService.permissionsUpdated$
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe(() => {
        // Metadata fetch is permission-gated, so re-evaluate it after the
        // refreshed rules arrive (e.g. the user was just granted admin access).
        void this.fetchPermissions().then(() => this.fetchRbacMetadata());
        // Role change can flip role-bound feature flags for this user.
        void this.#featureFlagsStore.reload();
      });

    this.#notificationsService.featureFlagsUpdated$
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe(() => {
        void this.#featureFlagsStore.reload();
      });
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.#http
      .post<AuthResponse>(AuthApiEnum.Login, credentials, {
        context: silentContext()
      })
      .pipe(
        switchMap((response) => {
          this.#authStore.saveAuthResponse(response);
          this.scheduleTokenRefresh();
          // reload(), not load(): flags may already be loaded from the
          // anonymous bootstrap and the authenticated set can differ.
          void this.#featureFlagsStore.reload();
          return from(this.fetchPermissions()).pipe(
            tap(() => {
              void this.fetchRbacMetadata();
              this.#notificationsService.connect();
            }),
            switchMap(() => [response])
          );
        })
      );
  }

  register(
    registerData: RegisterRequest,
    captchaToken?: string | null
  ): Observable<User> {
    const body = captchaToken
      ? { ...registerData, captchaToken }
      : registerData;
    return this.#http.post<User>(AuthApiEnum.Register, body, {
      context: silentContext()
    });
  }

  logout(returnUrl?: string): void {
    this.#tokenService.cancelRefresh();

    const completeLogout = () => {
      if (returnUrl) {
        navigateToLogin(this.#router, returnUrl);
      } else {
        void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`]);
      }
    };

    if (this.#authStore.isAuthenticated()) {
      this.#http
        .post(AuthApiEnum.Logout, {}, { context: silentContext() })
        .pipe(
          finalize(() => {
            this.#notificationsService.disconnect();
            this.#authStore.clearSession();
            this.#rbacMetadataStore.clear();
            this.#featureFlagsStore.clear();
            completeLogout();
          })
        )
        .subscribe();
    } else {
      this.#rbacMetadataStore.clear();
      this.#featureFlagsStore.clear();
      completeLogout();
    }
  }

  getProfile(): Observable<User> {
    return this.#http
      .get<User>(AuthApiEnum.Profile)
      .pipe(tap((profile) => this.#authStore.updateCurrentUser(profile)));
  }

  updateProfile(data: UpdateProfile): Observable<User> {
    return this.#http
      .patch<User>(AuthApiEnum.Profile, data)
      .pipe(tap((user) => this.#authStore.updateCurrentUser(user)));
  }

  hasPersistedUser(): boolean {
    return this.#authStore.hasPersistedUser();
  }

  refreshTokens(): Observable<TokensResponse | null> {
    return this.#tokenService.refreshTokens();
  }

  scheduleTokenRefresh(): void {
    this.#tokenService.scheduleTokenRefresh();
  }

  cancelRefresh(): void {
    this.#tokenService.cancelRefresh();
  }

  getOAuthAccounts(): Observable<{ provider: string; createdAt: string }[]> {
    return this.#http.get<{ provider: string; createdAt: string }[]>(
      AuthApiEnum.OAuthAccounts
    );
  }

  exchangeOAuthData(): Observable<AuthResponse> {
    return this.#http.post<AuthResponse>(
      AuthApiEnum.OAuthExchange,
      {},
      { withCredentials: true }
    );
  }

  initOAuthLink(): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(AuthApiEnum.OAuthLinkInit, {});
  }

  unlinkOAuthAccount(provider: string): Observable<{ message: string }> {
    return this.#http.delete<{ message: string }>(
      `${AuthApiEnum.OAuthAccounts}/${provider}`
    );
  }

  forgotPassword(
    email: string,
    captchaToken?: string | null
  ): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.ForgotPassword,
      captchaToken ? { email, captchaToken } : { email },
      { context: silentContext() }
    );
  }

  resetPassword(
    token: string,
    password: string
  ): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.ResetPassword,
      { token, password },
      { context: silentContext() }
    );
  }

  verifyEmail(token: string): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.VerifyEmail,
      { token },
      { context: silentContext() }
    );
  }

  resendVerificationEmail(email: string): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.ResendVerification,
      { email },
      { context: silentContext() }
    );
  }

  initiateEmailChange(
    newEmail: string,
    currentPassword: string
  ): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.InitiateEmailChange,
      { newEmail, currentPassword },
      { context: silentContext() }
    );
  }

  confirmEmailChange(token: string): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.ConfirmEmailChange,
      { token },
      { context: silentContext() }
    );
  }

  fetchPermissions(): Promise<void> {
    return firstValueFrom(
      this.#http.get<UserPermissionsResponse>(AuthApiEnum.Permissions, {
        context: silentContext()
      })
    )
      .then((response) => {
        this.#authStore.setRules(response.rules);
      })
      .catch((error) => {
        console.error('Failed to fetch permissions:', error);
      });
  }

  fetchRbacMetadata(): Promise<void> {
    // GET /rbac/metadata requires `read Permission` on the server; skip the
    // doomed request (and its server-side denial audit entry) for users
    // without it. Callers must ensure permissions are already loaded.
    if (
      !this.#authStore.hasPermissions({ action: 'read', subject: 'Permission' })
    ) {
      return Promise.resolve();
    }
    const load = () =>
      firstValueFrom(this.#rbacMetadataService.getMetadata())
        .then((data) => {
          this.#rbacMetadataStore.setMetadata(data.resources, data.actions);
        })
        .catch(
          () => undefined /* silently ignore — app functions without metadata */
        );

    if (this.#rbacMetadataStore.resources().length > 0) {
      void load();
      return Promise.resolve();
    }
    return load();
  }

  initSession(): void {
    if (this.isAuthenticated()) {
      this.scheduleTokenRefresh();
      void this.fetchPermissions();
      void this.#featureFlagsStore.reload();
    }
  }
}

export { AUTH_USER_KEY };
