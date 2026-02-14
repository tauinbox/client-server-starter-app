import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { OAuthUserProfile } from '../types/oauth-profile';
import { OAuthProvider } from '../enums/oauth-provider.enum';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET'),
      callbackURL: '/api/v1/auth/oauth/google/callback',
      scope: ['email', 'profile']
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      emails?: { value: string }[];
      name?: { givenName?: string; familyName?: string };
    },
    done: VerifyCallback
  ): void {
    const oauthProfile: OAuthUserProfile = {
      provider: OAuthProvider.GOOGLE,
      providerId: profile.id,
      email: profile.emails?.[0]?.value || '',
      firstName: profile.name?.givenName || '',
      lastName: profile.name?.familyName || ''
    };

    done(null, oauthProfile);
  }
}
