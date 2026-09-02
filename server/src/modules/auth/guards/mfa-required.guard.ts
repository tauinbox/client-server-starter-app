import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorKeys } from '@app/shared/constants';
import { SKIP_MFA_ENROLMENT_GATE_KEY } from '../decorators/skip-mfa-enrolment-gate.decorator';
import { MfaPolicyService } from '../services/mfa-policy.service';
import { JwtAuthRequest } from '../types/auth.request';

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
    private readonly mfaPolicy: MfaPolicyService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_MFA_ENROLMENT_GATE_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (skip === true) {
      return true;
    }

    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    const { user } = req;

    if (!user) {
      throw new UnauthorizedException();
    }

    if (await this.mfaPolicy.mustEnrol(user.userId)) {
      throw new HttpException(
        {
          message:
            'Two-factor authentication must be turned on before this account can use the administration surface',
          errorKey: ErrorKeys.AUTH.MFA_ENROLMENT_REQUIRED
        },
        HttpStatus.FORBIDDEN
      );
    }

    return true;
  }
}
