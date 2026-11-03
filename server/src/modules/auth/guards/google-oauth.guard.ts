import { Injectable } from '@nestjs/common';
import { createOAuthProviderGuard } from './oauth-provider.guard';
import { OAuthProvider } from '../enums/oauth-provider.enum';

@Injectable()
export class GoogleOAuthGuard extends createOAuthProviderGuard('google', {
  provider: OAuthProvider.GOOGLE,
  displayName: 'Google'
}) {}
