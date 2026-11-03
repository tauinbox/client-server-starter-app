import { Injectable } from '@nestjs/common';
import { createOAuthProviderGuard } from './oauth-provider.guard';
import { OAuthProvider } from '../enums/oauth-provider.enum';

@Injectable()
export class VkOAuthGuard extends createOAuthProviderGuard('vkontakte', {
  provider: OAuthProvider.VK,
  displayName: 'VK'
}) {}
