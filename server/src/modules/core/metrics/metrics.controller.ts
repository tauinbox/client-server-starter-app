import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';

@ApiTags('Metrics')
@Public()
@Controller()
export class MetricsController extends PrometheusController {
  @Get()
  @ApiOperation({ summary: 'Prometheus metrics scrape endpoint' })
  index(@Res({ passthrough: true }) response: Response): Promise<string> {
    return super.index(response);
  }
}
