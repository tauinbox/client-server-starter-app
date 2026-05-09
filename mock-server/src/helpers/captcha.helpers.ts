import type { Response } from 'express';
import { ErrorKeys } from '@app/shared/constants';
import { getState } from '../state';

const CAPTCHA_THRESHOLD = 1;

export interface ThrottleConfig {
  name: string;
  ttlMs: number;
  limit: number;
}

// Mirror the server's @Throttle decorator values for the routes we gate.
export const CAPTCHA_ROUTE_LIMITS: Record<string, ThrottleConfig> = {
  register: { name: 'register', ttlMs: 60 * 60 * 1000, limit: 5 },
  'forgot-password': {
    name: 'forgot-password',
    ttlMs: 5 * 60 * 1000,
    limit: 2
  }
};

/**
 * Increments the per-IP attempt counter for the route, prunes the sliding
 * window, sets `X-RateLimit-Remaining` on the response, and returns the
 * remaining count after this request.
 */
export function trackAttemptAndSetHeader(
  route: ThrottleConfig,
  ip: string,
  res: Response
): number {
  const now = Date.now();
  const key = `${route.name}:${ip}`;
  const state = getState();

  const window = state.captchaAttempts.get(key) ?? { timestamps: [] };
  window.timestamps = window.timestamps.filter((t) => now - t < route.ttlMs);
  window.timestamps.push(now);
  state.captchaAttempts.set(key, window);

  const remaining = Math.max(0, route.limit - window.timestamps.length);
  res.setHeader('X-RateLimit-Limit', route.limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  return remaining;
}

/**
 * Returns null if the request can proceed without captcha (or with valid
 * captcha), otherwise returns an error payload to send back. Mock-server
 * accepts any non-empty token as valid since real Turnstile verification is
 * out of scope.
 */
export function evaluateCaptcha(
  remaining: number,
  captchaToken: unknown
): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
  const state = getState();
  if (!state.captchaConfig.enabled) return { ok: true };
  if (remaining > CAPTCHA_THRESHOLD) return { ok: true };

  const token = typeof captchaToken === 'string' ? captchaToken.trim() : '';
  if (!token) {
    return {
      ok: false,
      status: 400,
      body: {
        message: 'Captcha verification is required',
        statusCode: 400,
        errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
      }
    };
  }
  return { ok: true };
}
