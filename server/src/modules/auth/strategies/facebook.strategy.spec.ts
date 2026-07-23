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

  // emailVerified must propagate from `_json.verified`.
  it('sets emailVerified=true when Facebook asserts _json.verified=true', () => {
    strategy.validate(
      'access',
      'refresh',
      {
        id: 'fb-1',
        emails: [{ value: 'a@example.com' }],
        name: { givenName: 'A', familyName: 'B' },
        _json: { verified: true }
      },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(true);
    expect(profile.provider).toBe(OAuthProvider.FACEBOOK);
  });

  it('sets emailVerified=false when Facebook asserts _json.verified=false', () => {
    strategy.validate(
      'access',
      'refresh',
      {
        id: 'fb-2',
        emails: [{ value: 'b@example.com' }],
        name: { givenName: 'B', familyName: 'C' },
        _json: { verified: false }
      },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(false);
  });

  it('sets emailVerified=false when _json is missing', () => {
    strategy.validate(
      'access',
      'refresh',
      {
        id: 'fb-3',
        emails: [{ value: 'c@example.com' }],
        name: { givenName: 'C', familyName: 'D' }
      },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(false);
  });
});
