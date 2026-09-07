import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { FAILURE_COUNTER_BODY_FIELDS } from './failure-counter.decorator';
import type { DecrementableThrottlerStorage } from './throttler-storage.interface';

const LOGIN_LONG_WINDOW = 'login-long-window';

/**
 * Extends ThrottlerGuard so that the `login-long-window` throttler only counts
 * failed login attempts. On a successful response (HTTP < 400) the increment
 * that was speculatively written to the store is removed, keeping the counter
 * accurate for brute-force protection without penalising legitimate logins.
 *
 * A route that guards one field of a mixed payload marks it with
 * `@CountFailuresOnlyWhenBody`; requests without that field then bypass this
 * counter and keep only the limits that apply to every request.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  // Narrows the inherited storage to the contract the refund needs, so a
  // storage without `decrement` fails to compile at the wiring site.
  declare protected readonly storageService: DecrementableThrottlerStorage;

  protected override async handleRequest(
    requestProps: ThrottlerRequest
  ): Promise<boolean> {
    if (requestProps.throttler.name !== LOGIN_LONG_WINDOW) {
      return super.handleRequest(requestProps);
    }

    if (this.skipsFailureCounter(requestProps.context)) {
      return true;
    }

    // Run the standard check (increments counter, throws if blocked).
    const allowed = await super.handleRequest(requestProps);

    // Compute the storage key so we can undo the increment on success.
    const { context, getTracker, generateKey, throttler } = requestProps;
    const { req, res } = this.getRequestResponse(context);
    const tracker = await getTracker(req as Record<string, unknown>, context);
    // throttler.name is LOGIN_LONG_WINDOW — verified by the guard at the top
    const key = generateKey(
      context,
      tracker,
      throttler.name ?? LOGIN_LONG_WINDOW
    );

    (res as Response).on('finish', () => {
      if ((res as Response).statusCode < 400) {
        void this.storageService.decrement(key);
      }
    });

    return allowed;
  }

  /**
   * True when the handler counts failures only for requests that present a
   * secret, and this request presents none. Returning early leaves the counter
   * untouched, so the route stays open to the fields it does not guard.
   */
  private skipsFailureCounter(context: ExecutionContext): boolean {
    const fields = this.reflector.getAllAndOverride<string[] | undefined>(
      FAILURE_COUNTER_BODY_FIELDS,
      [context.getHandler(), context.getClass()]
    );

    if (!fields?.length) {
      return false;
    }

    const { req } = this.getRequestResponse(context);
    const body = (req as Request).body as Record<string, unknown> | undefined;

    return !fields.some((field) => body?.[field] !== undefined);
  }
}
