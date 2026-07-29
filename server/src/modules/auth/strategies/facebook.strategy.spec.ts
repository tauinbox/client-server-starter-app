import { FacebookStrategy } from './facebook.strategy';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import type { OAuthUserProfile } from '../types/oauth-profile';
import { createMockConfigService } from '../../../common/testing/config-service.mock';

function makeStrategy(): FacebookStrategy {
  return new FacebookStrategy(
    createMockConfigService({
      FACEBOOK_CLIENT_ID: 'test-client-id',
      FACEBOOK_CLIENT_SECRET: 'test-client-secret'
    })
  );
}

describe('FacebookStrategy.validate', () => {
  let strategy: FacebookStrategy;
  let done: jest.Mock;

  beforeEach(() => {
    strategy = makeStrategy();
    done = jest.fn();
  });

  it('never reports the address as verified', () => {
    strategy.validate(
      'access',
      'refresh',
      {
        id: 'fb-1',
        emails: [{ value: 'a@example.com' }],
        name: { givenName: 'A', familyName: 'B' }
      },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(false);
    expect(profile.provider).toBe(OAuthProvider.FACEBOOK);
  });

  it('ignores an account-level verified flag on the raw profile', () => {
    strategy.validate(
      'access',
      'refresh',
      {
        id: 'fb-2',
        emails: [{ value: 'b@example.com' }],
        name: { givenName: 'B', familyName: 'C' },
        // @ts-expect-error the strategy deliberately does not accept `_json`
        _json: { verified: true }
      },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(false);
  });

  // A provider-cased address would otherwise miss the exact-match lookup in
  // loginWithOAuth and create a case-variant duplicate account.
  it('canonicalizes the address the provider asserts', () => {
    strategy.validate(
      'access',
      'refresh',
      {
        id: 'fb-4',
        emails: [{ value: ' John@Example.COM ' }],
        name: { givenName: 'John', familyName: 'Doe' }
      },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.email).toBe('john@example.com');
  });
});
