import { Logger } from '@nestjs/common';
import type { CaptchaVerifier } from './captcha-verifier';

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Siteverify is one round trip to Cloudflare. The cap exists so an endpoint
 * that accepts the connection and never answers cannot hold a request handler
 * open: the attempt is abandoned and refused by the fail-closed branch below.
 */
const TURNSTILE_TIMEOUT_MS = 2500;

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  hostname?: string;
  challenge_ts?: string;
}

export class TurnstileVerifier implements CaptchaVerifier {
  readonly provider = 'turnstile';
  readonly siteKey: string;
  private readonly secretKey: string;
  private readonly logger = new Logger(TurnstileVerifier.name);

  constructor(keys: { siteKey: string; secretKey: string }) {
    ({ siteKey: this.siteKey, secretKey: this.secretKey } = keys);
  }

  async verify(token: string, remoteIp?: string): Promise<boolean> {
    const params = new URLSearchParams();

    params.set('secret', this.secretKey);
    params.set('response', token);

    if (remoteIp) params.set('remoteip', remoteIp);

    try {
      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS)
      });

      if (!response.ok) {
        this.logger.warn(
          `Turnstile siteverify HTTP ${response.status} ${response.statusText}`
        );

        return false;
      }

      const data = (await response.json()) as TurnstileVerifyResponse;

      if (!data.success) {
        this.logger.warn(
          `Turnstile rejected token: ${(data['error-codes'] ?? []).join(',')}`
        );
      }

      return data.success === true;
    } catch (err) {
      // Network failure: fail closed, never bypass the captcha on an outage.
      this.logger.error('Turnstile siteverify request failed', err);

      return false;
    }
  }
}
