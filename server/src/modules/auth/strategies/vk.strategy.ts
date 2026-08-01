import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { StrategyOptions } from 'passport-vkontakte';
import { Strategy } from 'passport-vkontakte';
import type OAuth2Strategy from 'passport-oauth2';
import { ConfigService } from '@nestjs/config';
import { normalizeEmail } from '@app/shared/utils/email';
import { OAuthUserProfile } from '../types/oauth-profile';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { CookieStateStore } from '../utils/cookie-state-store';

/**
 * passport-vkontakte hands its options to passport-oauth2, but its published
 * types stop at the VK-specific ones. Declaring the forwarded options here keeps
 * the literal below excess-property checked, so a misspelt `state` cannot
 * silently turn the OAuth CSRF protection off.
 */
export interface VkStrategyOptions extends StrategyOptions {
  scope: string[];
  state: boolean;
  store: OAuth2Strategy.StateStore;
}

@Injectable()
export class VkStrategy extends PassportStrategy(Strategy, 'vkontakte') {
  constructor(configService: ConfigService) {
    const options: VkStrategyOptions = {
      clientID: configService.getOrThrow('VK_CLIENT_ID'),
      clientSecret: configService.getOrThrow('VK_CLIENT_SECRET'),
      callbackURL: '/api/v1/auth/oauth/vk/callback',
      scope: ['email'],
      state: true,
      store: new CookieStateStore(
        OAuthProvider.VK,
        configService.get('ENVIRONMENT') === 'production'
      )
    };

    super(options);
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    params: { email?: string },
    profile: {
      id: string;
      name?: { givenName?: string; familyName?: string };
    },
    done: (error: Error | null, user?: OAuthUserProfile) => void
  ): void {
    const oauthProfile: OAuthUserProfile = {
      provider: OAuthProvider.VK,
      providerId: String(profile.id),
      email: normalizeEmail(params.email) ?? '',
      firstName: profile.name?.givenName || '',
      lastName: profile.name?.familyName || '',
      // VK OAuth does not expose an email-verification flag.
      emailVerified: false
    };

    done(null, oauthProfile);
  }
}
