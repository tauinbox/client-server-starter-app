import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult
} from '@nestjs/terminus';
import { MailService } from '../../mail/mail.service';

@Injectable()
export class SmtpHealthIndicator extends HealthIndicator {
  constructor(private readonly mailService: MailService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.mailService.verifySmtp();
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError(
        'SMTP check failed',
        this.getStatus(key, false)
      );
    }
  }
}
