import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { FEATURE_FLAG_KEY } from '../decorators/require-feature.decorator';
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
      throw new NotFoundException();
    }

    const user = await this.resolver.buildResolverUser(userId);
    const enabled = await this.resolver.isEnabledForUser(user, req, key);
    if (!enabled) {
      throw new NotFoundException();
    }
    return true;
  }
}
