import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { MailService } from '../../mail/mail.service';

@Injectable()
export class SmtpHealthIndicator extends HealthIndicator {
  constructor(private readonly mailService: MailService) {
    super();
  }

  // The API serves all traffic without working email, so a failed SMTP verify
  // degrades to a healthy-with-warning entry (mirrors RedisHealthIndicator)
  // rather than failing /health/ready and taking the whole container down.
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.mailService.verifySmtp();
      return this.getStatus(key, true);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.getStatus(key, true, {
        warning: `SMTP verify failed: ${reason}`
      });
    }
  }
}
