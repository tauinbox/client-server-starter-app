import { ConfigService } from '@nestjs/config';
import { VkStrategy } from './vk.strategy';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import type { OAuthUserProfile } from '../types/oauth-profile';

function makeStrategy(): VkStrategy {
  const config = {
    getOrThrow: jest.fn().mockImplementation((key: string) => {
      const map: Record<string, string> = {
        VK_CLIENT_ID: 'test-client-id',
        VK_CLIENT_SECRET: 'test-client-secret'
      };
      return map[key];
    }),
    get: jest.fn().mockReturnValue('development')
  } as unknown as ConfigService;
  return new VkStrategy(config);
}

describe('VkStrategy.validate', () => {
  // VK does not expose an email-verification flag, so emailVerified must
  // always be false. This forces the OAuth flow to send a verification email
  // when creating a new user via VK.
  it('always sets emailVerified=false (VK has no verified signal)', () => {
    const strategy = makeStrategy();
    const done = jest.fn();

    strategy.validate(
      'access',
      'refresh',
      { email: 'a@example.com' },
      { id: '12345', name: { givenName: 'A', familyName: 'B' } },
      done
    );

    const profile = (done.mock.calls[0] as [unknown, OAuthUserProfile])[1];
    expect(profile.emailVerified).toBe(false);
    expect(profile.provider).toBe(OAuthProvider.VK);
    expect(profile.email).toBe('a@example.com');
  });
});
