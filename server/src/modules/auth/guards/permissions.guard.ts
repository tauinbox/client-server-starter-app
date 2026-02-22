import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionService } from '../services/permission.service';
import { JwtAuthRequest } from '../types/auth.request';
import { SYSTEM_ROLES } from '@app/shared/constants';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<JwtAuthRequest>();

    // Admin role bypasses all permission checks
    if (user.roles?.includes(SYSTEM_ROLES.ADMIN)) {
      return true;
    }

    const userPermissions = await this.permissionService.getPermissionsForUser(
      user.userId
    );
    const userPermissionStrings = userPermissions.map((p) => p.permission);

    const hasAll = requiredPermissions.every((p) =>
      userPermissionStrings.includes(p)
    );

    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
