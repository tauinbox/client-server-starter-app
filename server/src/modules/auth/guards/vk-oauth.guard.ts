import { Injectable } from '@nestjs/common';
import { createOAuthProviderGuard } from './oauth-provider.guard';

@Injectable()
export class VkOAuthGuard extends createOAuthProviderGuard('vkontakte', 'VK') {}
