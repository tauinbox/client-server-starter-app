import { GoogleStrategy } from './google.strategy';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import type { OAuthUserProfile } from '../types/oauth-profile';
import { createMockConfigService } from '../../../common/testing/config-service.mock';

function makeStrategy(): GoogleStrategy {
  return new GoogleStrategy(
    createMockConfigService({
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret'
    })
  );
}

describe('GoogleStrategy.validate', () => {
  let strategy: GoogleStrategy;
  let done: jest.Mock;

  beforeEach(() => {
    strategy = makeStrategy();
    done = jest.fn();
  });

  // emailVerified must propagate from the provider's verified flag.
  it('sets emailVerified=true when Google asserts verified=true', () => {
    strategy.validate(
      'access',
      'refresh',
      {
        id: 'google-1',
        emails: [{ value: 'a@example.com', verified: true }],
        name: { givenName: 'A', familyName: 'B' }
      },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(true);
    expect(profile.provider).toBe(OAuthProvider.GOOGLE);
    expect(profile.email).toBe('a@example.com');
  });

  it('sets emailVerified=false when Google asserts verified=false', () => {
    strategy.validate(
      'access',
      'refresh',
      {
        id: 'google-2',
        emails: [{ value: 'b@example.com', verified: false }],
        name: { givenName: 'B', familyName: 'C' }
      },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(false);
  });

  it('sets emailVerified=false when Google omits the verified flag', () => {
    strategy.validate(
      'access',
      'refresh',
      {
        id: 'google-3',
        emails: [{ value: 'c@example.com' }],
        name: { givenName: 'C', familyName: 'D' }
      },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(false);
  });

  it('sets emailVerified=false when emails array is missing', () => {
    strategy.validate(
      'access',
      'refresh',
      { id: 'google-4', name: { givenName: 'D', familyName: 'E' } },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(false);
    expect(profile.email).toBe('');
  });
});
