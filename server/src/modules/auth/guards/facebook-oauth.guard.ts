import { Injectable } from '@nestjs/common';
import { createOAuthProviderGuard } from './oauth-provider.guard';

@Injectable()
export class FacebookOAuthGuard extends createOAuthProviderGuard(
  'facebook',
  'Facebook'
) {}
