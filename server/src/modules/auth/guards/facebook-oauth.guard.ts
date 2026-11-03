import { Injectable } from '@nestjs/common';
import { createOAuthProviderGuard } from './oauth-provider.guard';
import { OAuthProvider } from '../enums/oauth-provider.enum';

@Injectable()
export class FacebookOAuthGuard extends createOAuthProviderGuard('facebook', {
  provider: OAuthProvider.FACEBOOK,
  displayName: 'Facebook'
}) {}
