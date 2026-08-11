import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { MailService } from '../../mail/mail.service';

// verifySmtp() opens a fresh connection and runs EHLO + AUTH against the
// provider on every call, and the container healthcheck probes /ready every
// 30s - 2880 logins a day against a remote SMTP server. Any value at or above
// the healthcheck interval cuts that down; a recovery surfaces within one TTL.
const VERIFY_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class SmtpHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(SmtpHealthIndicator.name);
  private cached?: { ok: boolean; at: number };
  private inFlight?: Promise<boolean>;

  constructor(private readonly mailService: MailService) {
    super();
  }

  // The API serves all traffic without working email, so a failed SMTP verify
  // degrades to healthy-with-warning (mirrors RedisHealthIndicator). The
  // warning stays generic: /health/ready is public, detail goes to the log.
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const ok = await this.verify();
    return ok
      ? this.getStatus(key, true)
      : this.getStatus(key, true, {
          warning: 'SMTP verify failed'
        });
  }

  private verify(): Promise<boolean> {
    const cached = this.cached;
    if (cached && Date.now() - cached.at < VERIFY_CACHE_TTL_MS) {
      return Promise.resolve(cached.ok);
    }
    // Without the in-flight guard concurrent probes each open their own login,
    // since the cache is only written once a verify completes.
    this.inFlight ??= this.runVerify().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runVerify(): Promise<boolean> {
    let ok = false;
    try {
      await this.mailService.verifySmtp();
      ok = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`SMTP verify failed: ${reason}`);
    }
    this.cached = { ok, at: Date.now() };
    return ok;
  }
}
