import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';
import { OAuthUserProfile } from '../types/oauth-profile';
import { OAuthProvider } from '../enums/oauth-provider.enum';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get('FACEBOOK_CLIENT_ID'),
      clientSecret: configService.get('FACEBOOK_CLIENT_SECRET'),
      callbackURL: '/api/v1/auth/oauth/facebook/callback',
      scope: ['email'],
      profileFields: ['id', 'emails', 'name']
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
    done: (error: Error | null, user?: OAuthUserProfile) => void
  ): void {
    const oauthProfile: OAuthUserProfile = {
      provider: OAuthProvider.FACEBOOK,
      providerId: profile.id,
      email: profile.emails?.[0]?.value || '',
      firstName: profile.name?.givenName || '',
      lastName: profile.name?.familyName || ''
    };

    done(null, oauthProfile);
  }
}
