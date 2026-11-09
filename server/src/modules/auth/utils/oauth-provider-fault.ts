import { OAuthProvider } from '../enums/oauth-provider.enum';

/**
 * The RFC 6749 answer to a code that was replayed or that expired. Google and
 * VK send it, and `passport-oauth2` turns it into a `TokenError`.
 */
function isInvalidGrant(error: object): boolean {
  return (
    'name' in error &&
    error.name === 'TokenError' &&
    'code' in error &&
    error.code === 'invalid_grant'
  );
}

/**
 * Facebook answers a replayed or an expired code with its own error body,
 * which `passport-facebook` turns into a `FacebookTokenError`. Code 100 alone
 * also covers a `redirect_uri` mismatch, which is a configuration fault, so
 * the message selects the case.
 */
const FACEBOOK_CODE_REFUSALS: readonly unknown[] = [
  'This authorization code has been used.',
  'This authorization code has expired.'
];

function isFacebookCodeRefusal(error: object): boolean {
  return (
    'name' in error &&
    error.name === 'FacebookTokenError' &&
    'code' in error &&
    error.code === 100 &&
    'message' in error &&
    FACEBOOK_CODE_REFUSALS.includes(error.message)
  );
}

/** The failures that the browser causes, for each provider. */
const BROWSER_REFUSALS: Record<OAuthProvider, (error: object) => boolean> = {
  [OAuthProvider.GOOGLE]: isInvalidGrant,
  [OAuthProvider.VK]: isInvalidGrant,
  [OAuthProvider.FACEBOOK]: (error) =>
    isInvalidGrant(error) || isFacebookCodeRefusal(error)
};

/**
 * Passport makes these from the error parameters of the callback query, before
 * it verifies the state.
 */
const ERROR_REDIRECTS: readonly unknown[] = [
  'AuthorizationError',
  'FacebookAuthorizationError'
];

export interface ProviderFaultContext {
  provider: OAuthProvider;
  /** True when the callback state matches a flow that this browser started. */
  stateIssued: boolean;
}

/**
 * True when the provider or the configuration failed. Passport reports a
 * refusal (a bad state, a declined consent screen) with no error. A real error
 * redirect repeats the state of its flow (RFC 6749 4.1.2.1), so one with no
 * issued state is a request that anyone can forge. The names are read as
 * values, because `passport-oauth2` and `passport-facebook` are not declared
 * dependencies.
 */
export function providerFault(
  error: unknown,
  { provider, stateIssued }: ProviderFaultContext
): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  if (typeof error !== 'object') {
    return true;
  }

  if ('name' in error && ERROR_REDIRECTS.includes(error.name) && !stateIssued) {
    return false;
  }

  return !BROWSER_REFUSALS[provider](error);
}
