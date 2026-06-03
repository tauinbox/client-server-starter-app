import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { ENTITLEMENT_KEY } from './require-entitlement.decorator';
import { EntitlementService } from './entitlement.service';
import type { EntitlementCapability } from './entitlement.types';

/**
 * Enforces the capability declared by `@RequireEntitlement`. Returns 403 when the
 * caller's plan does not grant it. This is the paid-access gate, not the
 * authorization gate — pair it with `@Authorize`/auth for the actual permission.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<
      EntitlementCapability | undefined
    >(ENTITLEMENT_KEY, [context.getHandler(), context.getClass()]);
    if (!capability) return true;

    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    const userId = req.user?.userId;
    if (!userId || !(await this.entitlements.has(userId, capability))) {
      throw new ForbiddenException(
        `This action requires the "${capability}" entitlement`
      );
    }
    return true;
  }
}
