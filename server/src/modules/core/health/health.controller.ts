import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorFunction,
  TypeOrmHealthIndicator
} from '@nestjs/terminus';
import {
  ApiOperation,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags
} from '@nestjs/swagger';
import { SmtpHealthIndicator } from './smtp.health';
import { MailService } from '../../mail/mail.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly smtp: SmtpHealthIndicator,
    private readonly mailService: MailService
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness — process is running' })
  @ApiOkResponse({ description: 'Process is running' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness — service can handle traffic' })
  @ApiOkResponse({ description: 'Service is ready' })
  @ApiServiceUnavailableResponse({ description: 'Service is not ready' })
  ready() {
    const checks: HealthIndicatorFunction[] = [
      () => this.db.pingCheck('database')
    ];
    if (this.mailService.isSmtpConfigured()) {
      checks.push(() => this.smtp.isHealthy('smtp'));
    }
    return this.health.check(checks);
  }
}
