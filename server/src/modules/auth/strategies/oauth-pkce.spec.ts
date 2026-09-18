import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import type * as passport from 'passport';
import { createMockConfigService } from '../../../common/testing/config-service.mock';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { FacebookStrategy } from './facebook.strategy';
import { GoogleStrategy } from './google.strategy';
import { VkStrategy } from './vk.strategy';

const config = createMockConfigService({
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  FACEBOOK_CLIENT_ID: 'id',
  FACEBOOK_CLIENT_SECRET: 'secret',
  VK_CLIENT_ID: 'id',
  VK_CLIENT_SECRET: 'secret'
});

/**
 * Runs the authorization half of a real provider strategy and returns the
 * provider redirect together with the state cookie it wrote. passport binds
 * its actions the same way, through Object.create.
 */
function startFlow(strategy: passport.Strategy): {
  location: URL;
  cookie: string;
} {
  let location: string | undefined;
  let cookie: string | undefined;

  // @ts-expect-error testing mock
  const res: Response = {
    cookie: (_name: string, value: string) => {
      cookie = value;
      return res;
    }
  };
  // @ts-expect-error testing mock
  const req: Request = { query: {}, cookies: {}, res };

  const created = Object.assign(Object.create(strategy) as passport.Strategy, {
    redirect: (url: string) => {
      location = url;
    },
    success: () => {
      throw new Error('the authorization half must not authenticate');
    },
    fail: () => {
      throw new Error('the authorization half must not fail');
    },
    pass: () => {
      throw new Error('the authorization half must not pass');
    },
    error: (err: unknown) => {
      throw err;
    }
  });
  // An absolute callback URL spares the request the host and socket fields
  // that passport-oauth2 reads to resolve a relative one.
  created.authenticate(req, { callbackURL: 'http://localhost:3000/cb' });

  return { location: new URL(location!), cookie: cookie! };
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

describe('OAuth strategies send PKCE', () => {
  it.each([
    [OAuthProvider.GOOGLE, () => new GoogleStrategy(config)],
    [OAuthProvider.FACEBOOK, () => new FacebookStrategy(config)],
    [OAuthProvider.VK, () => new VkStrategy(config)]
  ])(
    'binds the %s authorization request to a stored S256 verifier',
    (_provider, create) => {
      const { location, cookie } = startFlow(create());
      const [state, , ...verifierParts] = cookie.split('-');
      const verifier = verifierParts.join('-');

      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('state')).toBe(state);
      // RFC 7636 4.1: 43 to 128 characters.
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(location.searchParams.get('code_challenge')).toBe(s256(verifier));
    }
  );
});
