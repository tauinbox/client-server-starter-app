import type { OAuthError } from '@app/shared/constants';
import type { OAuthProvider } from '../enums/oauth-provider.enum';

/**
 * Where the browser is sent after a failure. A cancelled or failed link flow
 * started on the profile page belongs back there, not on the login page of an
 * already authenticated user. Both members are literals chosen in code - no
 * request value ever reaches the redirect.
 */
export type OAuthFailureRedirect = '/login' | '/profile';

export interface OAuthFailureOptions {
  reason?: unknown;
  redirectPath?: OAuthFailureRedirect;
  /** Set by the provider guard, so the filter can name the provider in its audit row. */
  provider?: OAuthProvider;
  /** Set by the provider guard when the provider or the configuration failed. */
  fault?: boolean;
}

/**
 * Raised when Passport rejects an OAuth request - a denied consent screen, an
 * expired state cookie, a failed code exchange. It exists so the failure can be
 * turned into a redirect back to the client instead of a JSON error body on the
 * API origin: the browser is mid-navigation here, not calling an API.
 */
export class OAuthAuthenticationFailedException extends Error {
  readonly reason?: unknown;
  readonly redirectPath: OAuthFailureRedirect;
  readonly provider?: OAuthProvider;
  /** True when the provider or the strategy failed, not the user or the request. */
  readonly fault: boolean;

  constructor(
    readonly oauthError: OAuthError,
    {
      reason,
      redirectPath = '/login',
      provider,
      fault = false
    }: OAuthFailureOptions = {}
  ) {
    super(`OAuth authentication failed (${oauthError})`);
    this.name = 'OAuthAuthenticationFailedException';
    this.reason = reason;
    this.redirectPath = redirectPath;
    this.provider = provider;
    this.fault = fault;
  }
}
