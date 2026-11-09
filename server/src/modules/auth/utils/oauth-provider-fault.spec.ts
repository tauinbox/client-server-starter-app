import { OAuthProvider } from '../enums/oauth-provider.enum';
import { providerFault } from './oauth-provider-fault';

const invalidGrant = { name: 'TokenError', code: 'invalid_grant' };
const invalidClient = { name: 'TokenError', code: 'invalid_client' };
const internal = Object.assign(new Error('Failed to obtain access token'), {
  name: 'InternalOAuthError'
});
const authorizationError = { name: 'AuthorizationError', code: 'server_error' };

function facebookTokenError(message: string, code = 100): object {
  return Object.assign(new Error(message), {
    name: 'FacebookTokenError',
    type: 'OAuthException',
    code
  });
}

describe('providerFault', () => {
  const issued = { stateIssued: true };

  it.each(Object.values(OAuthProvider))(
    'reports no error as a refusal (%s)',
    (provider) => {
      expect(providerFault(null, { provider, ...issued })).toBe(false);
      expect(providerFault(undefined, { provider, ...issued })).toBe(false);
    }
  );

  it.each(Object.values(OAuthProvider))(
    'reports invalid_grant as a refusal (%s)',
    (provider) => {
      expect(providerFault(invalidGrant, { provider, ...issued })).toBe(false);
    }
  );

  it.each(Object.values(OAuthProvider))(
    'reports a rejected client secret and a failed exchange as faults (%s)',
    (provider) => {
      expect(providerFault(invalidClient, { provider, ...issued })).toBe(true);
      expect(providerFault(internal, { provider, ...issued })).toBe(true);
      expect(providerFault('boom', { provider, ...issued })).toBe(true);
    }
  );

  it.each([
    'This authorization code has been used.',
    'This authorization code has expired.'
  ])('reports the Facebook answer "%s" as a refusal', (message) => {
    expect(
      providerFault(facebookTokenError(message), {
        provider: OAuthProvider.FACEBOOK,
        ...issued
      })
    ).toBe(false);
  });

  it('reports a Facebook redirect_uri mismatch as a fault', () => {
    expect(
      providerFault(
        facebookTokenError(
          'Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request'
        ),
        { provider: OAuthProvider.FACEBOOK, ...issued }
      )
    ).toBe(true);
  });

  it('reports the Facebook code answer with another code as a fault', () => {
    expect(
      providerFault(
        facebookTokenError('This authorization code has been used.', 190),
        { provider: OAuthProvider.FACEBOOK, ...issued }
      )
    ).toBe(true);
  });

  it.each([OAuthProvider.GOOGLE, OAuthProvider.VK])(
    'reports the Facebook code answer at %s as a fault',
    (provider) => {
      expect(
        providerFault(
          facebookTokenError('This authorization code has been used.'),
          { provider, ...issued }
        )
      ).toBe(true);
    }
  );

  it.each([
    [OAuthProvider.GOOGLE, authorizationError],
    [OAuthProvider.VK, authorizationError],
    [
      OAuthProvider.FACEBOOK,
      { name: 'FacebookAuthorizationError', code: 1, message: 'x' }
    ]
  ])(
    'reports an error redirect with no issued state as a refusal (%s)',
    (provider, error) => {
      expect(providerFault(error, { provider, stateIssued: false })).toBe(
        false
      );
    }
  );

  it.each([
    [OAuthProvider.GOOGLE, authorizationError],
    [OAuthProvider.VK, authorizationError],
    [
      OAuthProvider.FACEBOOK,
      { name: 'FacebookAuthorizationError', code: 1, message: 'x' }
    ]
  ])(
    'reports an error redirect with an issued state as a fault (%s)',
    (provider, error) => {
      expect(providerFault(error, { provider, ...issued })).toBe(true);
    }
  );

  it('reports an exchange fault as a fault when no state was issued', () => {
    expect(
      providerFault(internal, {
        provider: OAuthProvider.GOOGLE,
        stateIssued: false
      })
    ).toBe(true);
  });
});
