import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { MailService } from '../../mail/mail.service';

@Injectable()
export class SmtpHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(SmtpHealthIndicator.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  // The API serves all traffic without working email, so a failed SMTP verify
  // degrades to healthy-with-warning (mirrors RedisHealthIndicator). The
  // warning stays generic: /health/ready is public, detail goes to the log.
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.mailService.verifySmtp();
      return this.getStatus(key, true);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`SMTP verify failed: ${reason}`);
      return this.getStatus(key, true, {
        warning: 'SMTP verify failed'
      });
    }
  }
}
