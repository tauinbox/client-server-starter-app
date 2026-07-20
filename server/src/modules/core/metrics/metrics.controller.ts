import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { InternalNetworkGuard } from './internal-network.guard';

// @Public skips the JWT guard (Prometheus has no bearer token); the
// internal-network guard still keeps the scrape off the public internet.
@ApiTags('Metrics')
@Public()
@UseGuards(InternalNetworkGuard)
@Controller()
export class MetricsController extends PrometheusController {
  @Get()
  @ApiOperation({ summary: 'Prometheus metrics scrape endpoint' })
  index(@Res({ passthrough: true }) response: Response): Promise<string> {
    return super.index(response);
  }
}
