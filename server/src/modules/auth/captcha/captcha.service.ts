import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  hostname?: string;
  challenge_ts?: string;
}

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private readonly secretKey: string | undefined;
  private readonly siteKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('TURNSTILE_SECRET_KEY');
    this.siteKey = this.configService.get<string>('TURNSTILE_SITE_KEY');
  }

  isEnabled(): boolean {
    return Boolean(this.secretKey && this.siteKey);
  }

  getSiteKey(): string | null {
    return this.siteKey ?? null;
  }

  async verify(token: string, remoteIp?: string): Promise<boolean> {
    if (!this.secretKey) return true;
    if (!token) return false;

    const params = new URLSearchParams();
    params.set('secret', this.secretKey);
    params.set('response', token);
    if (remoteIp) params.set('remoteip', remoteIp);

    try {
      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
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
      // Network failure — fail closed (do NOT bypass captcha on outage).
      this.logger.error('Turnstile siteverify request failed', err);
      return false;
    }
  }
}
