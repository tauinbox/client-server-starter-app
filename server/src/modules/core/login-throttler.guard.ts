import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import type { Response } from 'express';

const LOGIN_LONG_WINDOW = 'login-long-window';

/**
 * Extends ThrottlerGuard so that the `login-long-window` throttler only counts
 * failed login attempts. On a successful response (HTTP < 400) the increment
 * that was speculatively written to the store is removed, keeping the counter
 * accurate for brute-force protection without penalising legitimate logins.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected override async handleRequest(
    requestProps: ThrottlerRequest
  ): Promise<boolean> {
    if (requestProps.throttler.name !== LOGIN_LONG_WINDOW) {
      return super.handleRequest(requestProps);
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
        const storage = this.storageService as {
          decrement?: (key: string) => Promise<void>;
        };
        void storage.decrement?.(key);
      }
    });

    return allowed;
  }
}
