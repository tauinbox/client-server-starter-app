import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator
} from '@nestjs/terminus';
import {
  ApiOperation,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags
} from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Check service health' })
  @ApiOkResponse({ description: 'Service is healthy' })
  @ApiServiceUnavailableResponse({ description: 'Service is unavailable' })
  check() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}
