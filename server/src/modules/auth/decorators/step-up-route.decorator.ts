import { applyDecorators } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { Throttle, type ThrottlerOptions } from '@nestjs/throttler';
import { CountFailuresOnlyWhenBody } from '../../core/failure-counter.decorator';
import { CHALLENGE_THROTTLE } from '../constants/throttle.constants';
import { MfaSetupDto } from '../dtos/mfa.dto';
import { StepUpFactorsDto } from '../dtos/step-up-factors.dto';

type StepUpBody = typeof StepUpFactorsDto | typeof MfaSetupDto;

const SECRET_FIELDS = new Map<StepUpBody, string[]>([
  [StepUpFactorsDto, ['currentPassword', 'code']],
  [MfaSetupDto, ['currentPassword']]
]);

/**
 * The decorators of a route that verifies a step-up secret. The throttle and
 * the body rule come together, so a step-up route cannot carry the failure
 * budget without the rule that keeps a request with no secret off it.
 *
 * The body is optional: an account with no password proves itself with the
 * `reauth_proof` cookie and sends no secret.
 */
export const StepUpRoute = (
  dto: StepUpBody,
  throttle: Record<string, ThrottlerOptions> = CHALLENGE_THROTTLE
) =>
  applyDecorators(
    Throttle(throttle),
    CountFailuresOnlyWhenBody(...(SECRET_FIELDS.get(dto) ?? [])),
    ApiBody({ type: dto, required: false })
  );
