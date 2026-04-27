import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { StrategyOptions } from 'passport-google-oauth20';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { OAuthUserProfile } from '../types/oauth-profile';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { CookieStateStore } from '../utils/cookie-state-store';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.getOrThrow('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow('GOOGLE_CLIENT_SECRET'),
      callbackURL: '/api/v1/auth/oauth/google/callback',
      scope: ['email', 'profile'],
      state: true,
      store: new CookieStateStore(
        configService.get('ENVIRONMENT') === 'production'
      )
    } as StrategyOptions);
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      emails?: { value: string; verified?: boolean }[];
      name?: { givenName?: string; familyName?: string };
    },
    done: VerifyCallback
  ): void {
    const primaryEmail = profile.emails?.[0];
    const oauthProfile: OAuthUserProfile = {
      provider: OAuthProvider.GOOGLE,
      providerId: profile.id,
      email: primaryEmail?.value || '',
      firstName: profile.name?.givenName || '',
      lastName: profile.name?.familyName || '',
      emailVerified: primaryEmail?.verified === true
    };

    done(null, oauthProfile);
  }
}
