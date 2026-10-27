import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import { bindAuditContext } from '../casl/ability-context';
import type { PermissionCheck } from '../casl/app-ability';
import { JwtAuthRequest } from '../types/auth.request';
import { AuditService } from '../../audit/audit.service';
import { ErrorKeys } from '@app/shared/constants';
import { MetricsService } from '../../core/metrics/metrics.service';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { refuseAccess } from '../../../common/utils/refuse-access.util';
import { ApiError } from '../../../common/errors/api-error';

/** The metric labels and the audited `action:subject` of each check. */
export function describeChecks(
  checks: PermissionCheck[]
): { action: string; subject: string }[] {
  return checks.map(([action, subject]) => ({
    action: String(action),
    subject:
      typeof subject === 'string'
        ? subject
        : ((subject as { name?: string })?.name ?? 'unknown')
  }));
}

export function requiredLabels(checks: PermissionCheck[]): string[] {
  return describeChecks(checks).map((c) => `${c.action}:${c.subject}`);
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
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

    if (!user) {
      // eslint-disable-next-line no-restricted-syntax -- a bare 401: the client handles it by status, never by text
      throw new UnauthorizedException();
    }

    const { ability } = await this.caslAbilityFactory.resolveForUser(
      user.userId
    );
    const auditContext = extractAuditContext(req);
    bindAuditContext(ability, auditContext);

    // Attach for downstream instance-level checks via @CurrentAbility()
    req.ability = ability;

    const denied = requiredPermissions.filter(
      ([action, subject]) => !ability.can(action, subject)
    );

    if (denied.length > 0) {
      refuseAccess(
        this.auditService,
        this.metricsService,
        {
          actorId: user.userId,
          details: { required: requiredLabels(requiredPermissions) },
          context: auditContext,
          level: 'guard',
          denied: describeChecks(denied)
        },
        new ApiError(
          ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS,
          'Insufficient permissions'
        )
      );
    }

    return true;
  }
}
