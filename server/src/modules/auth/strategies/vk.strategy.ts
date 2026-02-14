import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-vkontakte';
import { ConfigService } from '@nestjs/config';
import { OAuthUserProfile } from '../types/oauth-profile';
import { OAuthProvider } from '../enums/oauth-provider.enum';

@Injectable()
export class VkStrategy extends PassportStrategy(Strategy, 'vkontakte') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get('VK_CLIENT_ID'),
      clientSecret: configService.get('VK_CLIENT_SECRET'),
      callbackURL: '/api/v1/auth/oauth/vk/callback',
      scope: ['email']
    } as ConstructorParameters<typeof Strategy>[0] & { scope: string[] });
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
      email: params.email || '',
      firstName: profile.name?.givenName || '',
      lastName: profile.name?.familyName || ''
    };

    done(null, oauthProfile);
  }
}
