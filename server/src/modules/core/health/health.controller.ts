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
import { ConfigService } from '@nestjs/config';
import { SmtpHealthIndicator } from './smtp.health';
import { RedisHealthIndicator } from './redis.health';
import { MailService } from '../../mail/mail.service';
import { Public } from '../../auth/decorators/public.decorator';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly smtp: SmtpHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly mailService: MailService,
    private readonly config: ConfigService
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
    if (this.config.get('ENVIRONMENT') === 'production') {
      checks.push(() => this.redis.isHealthy('redis'));
    }
    if (this.mailService.isSmtpConfigured()) {
      checks.push(() => this.smtp.isHealthy('smtp'));
    }
    return this.health.check(checks);
  }
}
