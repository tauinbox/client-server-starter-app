import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService
} from '@nestjs/terminus';
import { MailService } from '../../mail/mail.service';
import {
  DEPENDENCY_HEALTH_REF,
  DependencyHealthRef
} from '../metrics/dependency-up.gauge';

// verifySmtp() opens a fresh connection and runs EHLO + AUTH against the
// provider on every call, and the container healthcheck probes /ready every
// 30s - 2880 logins a day against a remote SMTP server. Any value at or above
// the healthcheck interval cuts that down; a recovery surfaces within one TTL.
const VERIFY_CACHE_TTL_MS = 5 * 60 * 1000;

// The transport timeouts alone do not bound a verify (connect + greeting +
// an idle AUTH add up past the 10s container probe timeout), and the deploy
// health gate waits on the first /ready of a fresh container.
const VERIFY_TIMEOUT_MS = 3000;

@Injectable()
export class SmtpHealthIndicator {
  private readonly logger = new Logger(SmtpHealthIndicator.name);
  private cached?: { ok: boolean; at: number };
  private inFlight?: Promise<boolean>;

  constructor(
    private readonly mailService: MailService,
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(DEPENDENCY_HEALTH_REF)
    private readonly dependencyHealth: DependencyHealthRef
  ) {}

  // The API serves all traffic without working email, so a failed verify
  // degrades to healthy-with-warning (mirrors RedisHealthIndicator) and the
  // warning stays generic - /health/ready is public. Because the payload stays
  // green, the gauge is the only alertable signal of the degraded state.
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const ok = await this.verify();
    this.dependencyHealth.statuses.set(key, ok);
    return ok
      ? indicator.up()
      : indicator.up({ warning: 'SMTP verify failed' });
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
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${VERIFY_TIMEOUT_MS} ms`)),
        VERIFY_TIMEOUT_MS
      );
    });
    try {
      await Promise.race([this.mailService.verifySmtp(), timeout]);
      ok = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`SMTP verify failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
    this.cached = { ok, at: Date.now() };
    return ok;
  }
}
