import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorKeys } from '@app/shared/constants';
import { SKIP_MFA_ENROLMENT_GATE_KEY } from '../decorators/skip-mfa-enrolment-gate.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { PermissionCheck } from '../casl/app-ability';
import { MfaPolicyService } from '../services/mfa-policy.service';
import { JwtAuthRequest } from '../types/auth.request';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { refuseAccess } from '../../../common/utils/refuse-access.util';
import { ApiError } from '../../../common/errors/api-error';
import { describeChecks, requiredLabels } from './permissions.guard';

/**
 * Refuses the protected surface to an account that owes a two-factor
 * enrolment. It runs in front of PermissionsGuard, so it covers every route
 * that `@Authorize` carries: sign-in, the profile read and the enrolment
 * routes stay open, because an administrator who cannot sign in cannot enrol
 * either. `@SkipMfaEnrolmentGate()` opens one more route for the same reason.
 */
@Injectable()
export class MfaRequiredGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly mfaPolicy: MfaPolicyService,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_MFA_ENROLMENT_GATE_KEY,
      targets
    );

    if (skip === true) {
      return true;
    }

    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    const { user } = req;

    if (!user) {
      // eslint-disable-next-line no-restricted-syntax -- a bare 401: the client handles it by status, never by text
      throw new UnauthorizedException();
    }

    if (await this.mfaPolicy.mustEnrol(user.userId)) {
      const required =
        this.reflector.getAllAndOverride<PermissionCheck[] | undefined>(
          PERMISSIONS_KEY,
          targets
        ) ?? [];
      refuseAccess(
        this.auditService,
        this.metricsService,
        {
          actorId: user.userId,
          details: {
            required: requiredLabels(required),
            mfaEnrolmentRequired: true
          },
          context: extractAuditContext(req),
          level: 'guard',
          denied: describeChecks(required)
        },
        new ApiError(
          ErrorKeys.AUTH.MFA_ENROLMENT_REQUIRED,
          'Two-factor authentication must be turned on before this account can use the administration surface'
        )
      );
    }

    return true;
  }
}
