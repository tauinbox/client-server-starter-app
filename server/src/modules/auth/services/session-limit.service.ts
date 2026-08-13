import { Injectable, Logger } from '@nestjs/common';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants/auth.constants';
import { EntitlementService } from '../../billing/entitlements/entitlement.service';

/**
 * Resolves how many refresh tokens a user may hold at once. Paid tiers raise the
 * allowance above `MAX_CONCURRENT_SESSIONS`; a plan carrying no `sessions` limit
 * (Free, usage) keeps the constant.
 *
 * Both sign-in paths go through here rather than repeating the fallback, so the
 * password and OAuth halves can never drift apart — a Pro user trimmed to 5 the
 * moment they sign in with Google would silently evict devices they paid for.
 */
@Injectable()
export class SessionLimitService {
  private readonly logger = new Logger(SessionLimitService.name);

  constructor(private readonly entitlements: EntitlementService) {}

  /**
   * Fails open on purpose: a billing outage must never become a login outage,
   * so an unresolvable limit degrades to the built-in constant instead of
   * propagating out of `login`. The worst case is eviction at the old ceiling.
   */
  async maxSessionsFor(userId: string): Promise<number> {
    try {
      return (
        (await this.entitlements.limitFor(userId, 'sessions')) ??
        MAX_CONCURRENT_SESSIONS
      );
    } catch (error) {
      this.logger.warn(
        `Falling back to the default session limit for user ${userId}`,
        error as Error
      );
      return MAX_CONCURRENT_SESSIONS;
    }
  }
}
