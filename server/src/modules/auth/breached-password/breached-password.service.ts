import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorKeys } from '@app/shared/constants';
import {
  localPasswordRefusal,
  PASSWORD_TOO_COMMON_MESSAGE
} from '@app/shared/utils/password-policy';
import type { PasswordContext } from '@app/shared/utils/password-policy';
import { MetricsService } from '../../core/metrics/metrics.service';
import { lookupBreachedPassword } from './pwned-range-lookup';

export const BREACHED_PASSWORD_MESSAGE =
  'This password has appeared in a public data breach. Please choose a different one.';

/**
 * Rejects a prospective password that appears in a public breach corpus, is
 * one of the most common passwords, or contains the caller's own name, email
 * or the product name. NIST SP 800-63B-4 requires this of a verifier, in place
 * of the composition rules the same publication advises against.
 */
@Injectable()
export class BreachedPasswordService {
  private readonly logger = new Logger(BreachedPasswordService.name);
  private readonly rangeUrl: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService
  ) {
    this.rangeUrl = this.configService.get<string>('PWNED_PASSWORDS_RANGE_URL');
  }

  /**
   * Throws 400 when the password is listed. Call it on paths that SET a
   * password, never on one that verifies an existing password: an owner whose
   * password is already listed still has to get in to replace it.
   *
   * `context` holds the values the account will have after the write.
   */
  async assertNotBreached(
    password: string,
    context: PasswordContext
  ): Promise<void> {
    // First and with no network, so the most common passwords stay refused
    // while the range lookup below fails open.
    if (localPasswordRefusal(password, context)) {
      throw new HttpException(
        {
          message: PASSWORD_TOO_COMMON_MESSAGE,
          errorKey: ErrorKeys.AUTH.PASSWORD_TOO_COMMON
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const outcome = await lookupBreachedPassword(password, {
      rangeUrl: this.rangeUrl,
      // Fail OPEN, deliberately inverted from CaptchaService: refusing here
      // would turn an outage at the blocklist into an authentication outage.
      // The metric is what keeps the resulting gap visible.
      onUnavailable: (reason, err) =>
        this.logger.warn(
          `Breached-password lookup ${reason} - password accepted unchecked`,
          err
        )
    });

    this.metricsService.recordBreachLookup(outcome);

    if (outcome === 'breached') {
      throw new HttpException(
        {
          message: BREACHED_PASSWORD_MESSAGE,
          errorKey: ErrorKeys.AUTH.PASSWORD_BREACHED
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }
}
