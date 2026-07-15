import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorKeys } from '@app/shared/constants';
import { CaptchaService } from './captcha.service';

/**
 * Soft-trigger captcha verification. Runs AFTER the global ThrottlerGuard
 * so that `X-RateLimit-Remaining` is already set on the response. When the
 * remaining count for this client drops to {@link CAPTCHA_THRESHOLD} or
 * below, a valid `captchaToken` (Turnstile token) becomes mandatory.
 *
 * When TURNSTILE_SECRET_KEY/TURNSTILE_SITE_KEY are not configured, the
 * guard is a no-op so local dev and tests work without external dependency.
 */
const CAPTCHA_THRESHOLD = 1;

@Injectable()
export class CaptchaRequiredGuard implements CanActivate {
  constructor(private readonly captchaService: CaptchaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.captchaService.isEnabled()) return true;

    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    const res = httpCtx.getResponse<Response>();

    const remainingHeader = res.getHeader('X-RateLimit-Remaining');
    const remaining = Number(remainingHeader);
    if (
      remainingHeader === undefined ||
      remainingHeader === null ||
      !Number.isFinite(remaining)
    ) {
      // Missing or unparseable header means the gate has no rate-limit
      // signal: the APP_GUARD ThrottlerGuard should have set it, so this is
      // configuration drift. Fail closed rather than silently skip captcha.
      throw new InternalServerErrorException({
        message: 'Captcha gate cannot evaluate rate-limit state',
        errorKey: ErrorKeys.AUTH.CAPTCHA_GATE_FAILURE
      });
    }

    if (remaining > CAPTCHA_THRESHOLD) {
      return true;
    }

    const body = req.body as { captchaToken?: unknown } | undefined;
    const token =
      typeof body?.captchaToken === 'string' ? body.captchaToken.trim() : '';

    if (!token) {
      throw new HttpException(
        {
          message: 'Captcha verification is required',
          errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const verified = await this.captchaService.verify(token, req.ip);
    if (!verified) {
      throw new HttpException(
        {
          message: 'Captcha verification failed',
          errorKey: ErrorKeys.AUTH.CAPTCHA_INVALID
        },
        HttpStatus.BAD_REQUEST
      );
    }

    return true;
  }
}
