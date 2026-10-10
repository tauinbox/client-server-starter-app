import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PaddleClientConfigResponse } from '@app/shared/types';
import { Public } from '../../auth/decorators/public.decorator';
import { PlanResponseDto } from '../dtos/plan-response.dto';
import { PaddleProvider } from '../providers/paddle.provider';
import { PlanService } from '../services/plan.service';

@ApiTags('Billing API')
@Controller({
  path: 'billing',
  version: '1'
})
export class BillingPlansController {
  constructor(
    private readonly planService: PlanService,
    private readonly paddleProvider: PaddleProvider
  ) {}

  @Get('plans')
  @Public()
  @ApiOperation({
    summary:
      'List active billing plans. Public catalog: each plan carries the price for every configured provider; the client shows the price for the resolved billing region.'
  })
  @ApiOkResponse({ type: [PlanResponseDto] })
  findPlans() {
    return this.planService.findActive();
  }

  @Get('paddle-config')
  @Public()
  @ApiOperation({
    summary:
      'Get the public Paddle.js configuration (client-side token and environment). The token is null while Paddle is not configured.'
  })
  @ApiOkResponse({ description: 'Paddle.js public configuration' })
  getPaddleConfig(): PaddleClientConfigResponse {
    return this.paddleProvider.clientConfig();
  }
}
