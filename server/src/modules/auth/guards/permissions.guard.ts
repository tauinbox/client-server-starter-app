import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionService } from '../services/permission.service';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import type { PermissionCheck } from '../casl/app-ability';
import { JwtAuthRequest } from '../types/auth.request';
import { SYSTEM_ROLES } from '@app/shared/constants';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
    private readonly caslAbilityFactory: CaslAbilityFactory
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      PermissionCheck[]
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<JwtAuthRequest>();

    // Admin role bypasses all permission checks (performance optimization — skip DB call)
    if (user.roles?.includes(SYSTEM_ROLES.ADMIN)) {
      return true;
    }

    const userPermissions = await this.permissionService.getPermissionsForUser(
      user.userId
    );

    const ability = this.caslAbilityFactory.createForUser(
      user.userId,
      user.roles ?? [],
      userPermissions
    );

    const hasAll = requiredPermissions.every(([action, subject]) =>
      ability.can(action, subject)
    );

    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
