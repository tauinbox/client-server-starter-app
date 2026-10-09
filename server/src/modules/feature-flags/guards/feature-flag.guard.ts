import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { FEATURE_FLAG_KEY } from '../constants/feature-flag-metadata.constants';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: FeatureFlagResolverService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(
      FEATURE_FLAG_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!key) return true;

    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    const userId = req.user?.userId;
    if (!userId) {
      // eslint-disable-next-line no-restricted-syntax -- a hidden feature answers a bare 404, as a route that does not exist
      throw new NotFoundException();
    }

    const user = await this.resolver.buildResolverUser(userId);
    const enabled = await this.resolver.isEnabledForUser(user, req, key);
    if (!enabled) {
      // eslint-disable-next-line no-restricted-syntax -- a hidden feature answers a bare 404, as a route that does not exist
      throw new NotFoundException();
    }
    return true;
  }
}
