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
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
    private readonly caslAbilityFactory: CaslAbilityFactory,
    private readonly auditService: AuditService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      PermissionCheck[]
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    const { user } = req;

    const [roles, userPermissions] = await Promise.all([
      this.permissionService.getRolesForUser(user.userId),
      this.permissionService.getPermissionsForUser(user.userId)
    ]);

    const ability = await this.caslAbilityFactory.createForUser(
      user.userId,
      roles,
      userPermissions
    );

    const hasAll = requiredPermissions.every(([action, subject]) =>
      ability.can(action, subject)
    );

    if (!hasAll) {
      this.auditService.logFireAndForget({
        action: AuditAction.PERMISSION_CHECK_FAILURE,
        actorId: user.userId,
        details: {
          required: requiredPermissions.map(
            ([a, s]) => `${String(a)}:${String(s)}`
          )
        },
        context: { ip: req.ip }
      });
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
