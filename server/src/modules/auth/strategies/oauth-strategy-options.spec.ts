import type { StrategyOptions as FacebookStrategyOptions } from 'passport-facebook';
import type { StrategyOptions as GoogleStrategyOptions } from 'passport-google-oauth20';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { CookieStateStore } from '../utils/cookie-state-store';
import type { VkStrategyOptions } from './vk.strategy';

/**
 * Every OAuth strategy turns on CSRF protection with `state: true`. The option
 * objects are plain literals, so a misspelt key would compile and disable that
 * protection with no runtime signal. These checks fail the build - an unused
 * @ts-expect-error is itself an error - the moment a strategy's options stop
 * being excess-property checked.
 */
describe('OAuth strategy option typing', () => {
  it('rejects a misspelt state option on the VK strategy', () => {
    const options: VkStrategyOptions = {
      clientID: 'id',
      clientSecret: 'secret',
      callbackURL: '/cb',
      scope: ['email'],
      state: true,
      store: new CookieStateStore(OAuthProvider.VK, false),
      // @ts-expect-error - a misspelt `state` must not compile
      stat: true
    };

    expect(options.state).toBe(true);
  });

  it('rejects a misspelt state option on the Google strategy', () => {
    const options: GoogleStrategyOptions = {
      clientID: 'id',
      clientSecret: 'secret',
      callbackURL: '/cb',
      scope: ['email', 'profile'],
      state: true,
      store: new CookieStateStore(OAuthProvider.GOOGLE, false),
      // @ts-expect-error - a misspelt `state` must not compile
      stat: true
    };

    expect(options.clientID).toBe('id');
  });

  it('rejects a misspelt state option on the Facebook strategy', () => {
    const options: FacebookStrategyOptions = {
      clientID: 'id',
      clientSecret: 'secret',
      callbackURL: '/cb',
      scope: ['email'],
      profileFields: ['id', 'emails', 'name'],
      state: true,
      store: new CookieStateStore(OAuthProvider.FACEBOOK, false),
      // @ts-expect-error - a misspelt `state` must not compile
      stat: true
    };

    expect(options.clientID).toBe('id');
  });
});
