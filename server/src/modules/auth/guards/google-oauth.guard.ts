import { Injectable } from '@nestjs/common';
import { createOAuthProviderGuard } from './oauth-provider.guard';

@Injectable()
export class GoogleOAuthGuard extends createOAuthProviderGuard(
  'google',
  'Google'
) {}
