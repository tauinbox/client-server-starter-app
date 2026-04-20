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
import { MetricsService } from '../../core/metrics/metrics.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
    private readonly caslAbilityFactory: CaslAbilityFactory,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService
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

    // Attach for downstream instance-level checks via @CurrentAbility()
    req.ability = ability;

    const denied = requiredPermissions.filter(
      ([action, subject]) => !ability.can(action, subject)
    );

    if (denied.length > 0) {
      for (const [action, subject] of denied) {
        const subjectName =
          typeof subject === 'string'
            ? subject
            : ((subject as { name?: string })?.name ?? 'unknown');
        this.metricsService.recordPermissionDenied(
          'guard',
          String(action),
          subjectName
        );
      }
      this.auditService.logFireAndForget({
        action: AuditAction.PERMISSION_CHECK_FAILURE,
        actorId: user.userId,
        details: {
          required: requiredPermissions.map(
            ([a, s]) => `${String(a)}:${typeof s === 'string' ? s : '[object]'}`
          )
        },
        context: { ip: req.ip }
      });
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
